const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { scrapeSkillRack } = require('./skillrack-simple');

// Load environment variables from .env file
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
                process.env[key.trim()] = value.trim();
            }
        });
        console.log('✅ Environment variables loaded from .env file');
    }
} catch (error) {
    console.log('⚠️  Could not load .env file:', error.message);
}

// Configuration for 20K users
const CONFIG = {
    BATCH_SIZE: 100,       // Increased batch size
    CONCURRENCY: 10,       // More concurrent workers
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 2000,
    CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours
    REQUEST_TIMEOUT: 15000,
    RATE_LIMIT_DELAY: 200
};

// Cache management
class Cache {
    constructor() {
        this.cacheFile = path.join(__dirname, 'cache.json');
        this.cache = this.loadCache();
    }

    loadCache() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
            }
        } catch (error) {
            console.log('Cache load error:', error.message);
        }
        return {};
    }

    saveCache() {
        try {
            fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
        } catch (error) {
            console.log('Cache save error:', error.message);
        }
    }

    get(key) {
        const item = this.cache[key];
        if (item && Date.now() - item.timestamp < CONFIG.CACHE_DURATION) {
            return item.data;
        }
        return null;
    }

    set(key, data) {
        this.cache[key] = {
            data,
            timestamp: Date.now()
        };
    }
}

// Retry mechanism with exponential backoff
async function retryRequest(fn, attempts = CONFIG.RETRY_ATTEMPTS) {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === attempts - 1) throw error;
            const delay = CONFIG.RETRY_DELAY * Math.pow(2, i);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Rate limiting
class RateLimiter {
    constructor(delay = CONFIG.RATE_LIMIT_DELAY) {
        this.delay = delay;
        this.lastRequest = 0;
    }

    async wait() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequest;
        if (timeSinceLastRequest < this.delay) {
            await new Promise(resolve => setTimeout(resolve, this.delay - timeSinceLastRequest));
        }
        this.lastRequest = Date.now();
    }
}

// Separate rate limiters for different APIs
const rateLimiter = new RateLimiter(200); // General: 200ms (safer)
const githubUserLimiter = new RateLimiter(1200); // GitHub User API: 1.2s (5000/hour)
const githubSearchLimiter = new RateLimiter(3000); // GitHub Search: 3s (30/min) 
const leetcodeLimiter = new RateLimiter(500); // LeetCode: 500ms
const codeforcesLimiter = new RateLimiter(1000); // Codeforces: 1s
const skillrackLimiter = new RateLimiter(800); // SkillRack: 800ms (safer for scraping)
const cache = new Cache();

// Platform adapters
const Adapters = {
    leetcode: async (username) => {
        if (!username) return { total: 0, easy: 0, medium: 0, hard: 0 };
        
        const cacheKey = `leetcode_${username}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        await leetcodeLimiter.wait();
        
        return retryRequest(async () => {
            const query = `
                query userProblemsSolved($username: String!) {
                    allQuestionsCount {
                        difficulty
                        count
                    }
                    matchedUser(username: $username) {
                        problemsSolvedBeatsStats {
                            difficulty
                            percentage
                        }
                        submitStatsGlobal {
                            acSubmissionNum {
                                difficulty
                                count
                            }
                        }
                    }
                }
            `;

            const response = await axios.post('https://leetcode.com/graphql', {
                query,
                variables: { username }
            }, {
                timeout: CONFIG.REQUEST_TIMEOUT,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const data = response.data?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum;
            if (!data) return { total: 0, easy: 0, medium: 0, hard: 0 };

            const result = {
                total: data.find(item => item.difficulty === 'All')?.count || 0,
                easy: data.find(item => item.difficulty === 'Easy')?.count || 0,
                medium: data.find(item => item.difficulty === 'Medium')?.count || 0,
                hard: data.find(item => item.difficulty === 'Hard')?.count || 0
            };

            cache.set(cacheKey, result);
            return result;
        });
    },

    github: async (username) => {
        if (!username) return { repos: 0, mergedPRs: 0 };
        
        const cacheKey = `github_${username}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        await githubUserLimiter.wait();
        
        return retryRequest(async () => {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            };

            // Add GitHub token if available
            if (process.env.GITHUB_TOKEN) {
                headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
                console.log(`🔑 Using GitHub token for ${username}`);
            } else {
                console.log(`⚠️  No GitHub token - rate limits may apply for ${username}`);
            }

            try {
                // Get user info for repo count
                console.log(`📡 Fetching GitHub data for: ${username}`);
                const userResponse = await axios.get(`https://api.github.com/users/${username}`, {
                    headers,
                    timeout: CONFIG.REQUEST_TIMEOUT
                });

                console.log(`✅ GitHub user data for ${username}: ${userResponse.data.public_repos} repos`);

                let mergedPRs = 0;
                try {
                    // Wait for GitHub Search API rate limit
                    await githubSearchLimiter.wait();

                    // Get merged PRs count
                    const prResponse = await axios.get(`https://api.github.com/search/issues`, {
                        params: {
                            q: `is:pr is:merged author:${username}`,
                            per_page: 1
                        },
                        headers,
                        timeout: CONFIG.REQUEST_TIMEOUT
                    });

                    mergedPRs = prResponse.data.total_count || 0;
                    console.log(`✅ GitHub PR data for ${username}: ${mergedPRs} merged PRs`);
                } catch (prError) {
                    console.log(`⚠️  GitHub PR search failed for ${username}, using 0 PRs`);
                    mergedPRs = 0;
                }

                const result = {
                    repos: userResponse.data.public_repos || 0,
                    mergedPRs: mergedPRs
                };

                cache.set(cacheKey, result);
                return result;
                
            } catch (error) {
                console.error(`❌ GitHub API error for ${username}:`, error.message);
                if (error.response?.status === 403) {
                    console.error(`🚫 Rate limit exceeded for ${username}. Consider adding GITHUB_TOKEN to .env file`);
                } else if (error.response?.status === 404) {
                    console.log(`👤 GitHub user not found: ${username}`);
                }
                throw error;
            }
        });
    },

    codeforces: async (username) => {
        if (!username) return { solved: 0 };
        
        const cacheKey = `codeforces_${username}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        await codeforcesLimiter.wait();
        
        return retryRequest(async () => {
            const response = await axios.get(`https://codeforces.com/api/user.status`, {
                params: { handle: username },
                timeout: CONFIG.REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (response.data.status !== 'OK') {
                return { solved: 0 };
            }

            const solvedProblems = new Set();
            response.data.result.forEach(submission => {
                if (submission.verdict === 'OK') {
                    solvedProblems.add(`${submission.problem.contestId}-${submission.problem.index}`);
                }
            });

            const result = { solved: solvedProblems.size };
            cache.set(cacheKey, result);
            return result;
        });
    },

    atcoder: async (username) => {
        if (!username) return { solved: 0 };
        
        const cacheKey = `atcoder_${username}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        await rateLimiter.wait();
        
        return retryRequest(async () => {
            const response = await axios.get(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/ac_rank`, {
                params: { user: username },
                timeout: CONFIG.REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const result = { solved: response.data?.count || 0 };
            cache.set(cacheKey, result);
            return result;
        });
    },

    skillrack: async (skillrackData) => {
        if (!skillrackData) return { solved: 0, userInfo: null };
        
        // Handle both string and object formats
        if (typeof skillrackData === 'string') {
            return { solved: 0, userInfo: null }; // No ID/key available
        }
        
        if (!skillrackData.id || !skillrackData.key) {
            return { solved: 0, userInfo: null }; // No ID/key available
        }
        
        return await scrapeSkillRack(skillrackData, skillrackLimiter);
    }
};

// Worker function for processing students
async function processStudent(student) {
    const startTime = Date.now();
    
    try {
        const [leetcodeData, githubData, codeforcesData, atcoderData, skillrackData] = await Promise.allSettled([
            Adapters.leetcode(student.handles?.leetcode),
            Adapters.github(student.handles?.github),
            Adapters.codeforces(student.handles?.codeforces),
            Adapters.atcoder(student.handles?.atcoder),
            Adapters.skillrack(student.handles?.skillrack)
        ]);

        const result = {
            id: student.id,
            name: student.name,
            handles: student.handles,
            data: {
                leetcode: leetcodeData.status === 'fulfilled' ? leetcodeData.value : { total: 0, easy: 0, medium: 0, hard: 0 },
                github: githubData.status === 'fulfilled' ? githubData.value : { repos: 0, mergedPRs: 0 },
                codeforces: codeforcesData.status === 'fulfilled' ? codeforcesData.value : { solved: 0 },
                atcoder: atcoderData.status === 'fulfilled' ? atcoderData.value : { solved: 0 },
                skillrack: skillrackData.status === 'fulfilled' ? skillrackData.value : { solved: 0, userInfo: null }
            },
            processingTime: Date.now() - startTime,
            timestamp: new Date().toISOString()
        };

        // Calculate total competitive programming problems
        result.data.totalCP = result.data.leetcode.total + result.data.codeforces.solved + result.data.atcoder.solved + (result.data.skillrack.solved || 0);

        return result;
    } catch (error) {
        console.error(`Error processing student ${student.name}:`, error.message);
        return {
            id: student.id,
            name: student.name,
            handles: student.handles,
            data: {
                leetcode: { total: 0, easy: 0, medium: 0, hard: 0 },
                github: { repos: 0, mergedPRs: 0 },
                codeforces: { solved: 0 },
                atcoder: { solved: 0 },
                skillrack: { solved: 0, userInfo: null },
                totalCP: 0
            },
            processingTime: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

// Concurrent batch processor
async function processBatch(students, batchNumber) {
    console.log(`📦 Processing Batch ${batchNumber} (${students.length} students)...`);
    
    const semaphore = new Array(CONFIG.CONCURRENCY).fill(null);
    const results = [];
    
    for (let i = 0; i < students.length; i += CONFIG.CONCURRENCY) {
        const chunk = students.slice(i, i + CONFIG.CONCURRENCY);
        const chunkPromises = chunk.map(student => processStudent(student));
        
        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
        
        // Progress update
        const processed = Math.min(i + CONFIG.CONCURRENCY, students.length);
        console.log(`   ✓ Processed ${processed}/${students.length} students in batch ${batchNumber}`);
    }
    
    return results;
}

// Main scraper function
async function runScraper() {
    const startTime = Date.now();
    console.log('🚀 Starting automated web scraping system...');
    console.log(`📊 Configuration: Batch Size: ${CONFIG.BATCH_SIZE}, Concurrency: ${CONFIG.CONCURRENCY}`);
    
    try {
        // Load students data
        const students = await fs.readJson(path.join(__dirname, 'students_mock.json'));
        console.log(`📋 Loaded ${students.length} students`);
        
        const allResults = [];
        const totalBatches = Math.ceil(students.length / CONFIG.BATCH_SIZE);
        
        // Process in batches
        for (let i = 0; i < students.length; i += CONFIG.BATCH_SIZE) {
            const batch = students.slice(i, i + CONFIG.BATCH_SIZE);
            const batchNumber = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
            
            const batchResults = await processBatch(batch, batchNumber);
            allResults.push(...batchResults);
            
            // Save incremental results
            await fs.writeJson(path.join(__dirname, 'results.json'), allResults, { spaces: 2 });
            
            // Progress report
            const avgTime = batchResults.reduce((sum, r) => sum + r.processingTime, 0) / batchResults.length;
            console.log(`✅ Batch ${batchNumber}/${totalBatches} completed. Avg time per student: ${avgTime.toFixed(0)}ms`);
            
            // Brief pause between batches
            if (i + CONFIG.BATCH_SIZE < students.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // Save cache
        cache.saveCache();
        
        // Generate summary statistics
        const summary = generateSummary(allResults);
        await fs.writeJson(path.join(__dirname, 'summary.json'), summary, { spaces: 2 });
        
        const totalTime = Date.now() - startTime;
        console.log(`\n🎉 Scraping completed successfully!`);
        console.log(`📊 Total time: ${(totalTime / 1000).toFixed(2)}s`);
        console.log(`⚡ Average time per student: ${(totalTime / students.length).toFixed(0)}ms`);
        console.log(`📁 Results saved to: results.json`);
        console.log(`📈 Summary saved to: summary.json`);
        
        // Display top performers
        displayTopPerformers(allResults);
        
    } catch (error) {
        console.error('❌ Scraping failed:', error.message);
        process.exit(1);
    }
}

// Generate summary statistics
function generateSummary(results) {
    const summary = {
        totalStudents: results.length,
        timestamp: new Date().toISOString(),
        platforms: {
            leetcode: {
                totalProblems: results.reduce((sum, r) => sum + r.data.leetcode.total, 0),
                avgProblems: 0,
                topSolver: null
            },
            github: {
                totalRepos: results.reduce((sum, r) => sum + r.data.github.repos, 0),
                totalMergedPRs: results.reduce((sum, r) => sum + r.data.github.mergedPRs, 0),
                avgRepos: 0,
                avgMergedPRs: 0
            },
            codeforces: {
                totalProblems: results.reduce((sum, r) => sum + r.data.codeforces.solved, 0),
                avgProblems: 0
            },
            atcoder: {
                totalProblems: results.reduce((sum, r) => sum + r.data.atcoder.solved, 0),
                avgProblems: 0
            }
        },
        performance: {
            avgProcessingTime: results.reduce((sum, r) => sum + r.processingTime, 0) / results.length,
            errors: results.filter(r => r.error).length
        }
    };
    
    // Calculate averages
    summary.platforms.leetcode.avgProblems = summary.platforms.leetcode.totalProblems / results.length;
    summary.platforms.github.avgRepos = summary.platforms.github.totalRepos / results.length;
    summary.platforms.github.avgMergedPRs = summary.platforms.github.totalMergedPRs / results.length;
    summary.platforms.codeforces.avgProblems = summary.platforms.codeforces.totalProblems / results.length;
    summary.platforms.atcoder.avgProblems = summary.platforms.atcoder.totalProblems / results.length;
    
    // Find top solver
    const topLeetcodeSolver = results.reduce((max, r) => 
        r.data.leetcode.total > max.data.leetcode.total ? r : max
    );
    summary.platforms.leetcode.topSolver = {
        name: topLeetcodeSolver.name,
        problems: topLeetcodeSolver.data.leetcode.total
    };
    
    return summary;
}

// Display top performers
function displayTopPerformers(results) {
    console.log('\n🏆 TOP PERFORMERS:');
    
    // Top LeetCode solvers
    const topLeetCode = results
        .sort((a, b) => b.data.leetcode.total - a.data.leetcode.total)
        .slice(0, 5);
    
    console.log('\n💻 LeetCode Top 5:');
    topLeetCode.forEach((student, index) => {
        const lc = student.data.leetcode;
        console.log(`${index + 1}. ${student.name}: ${lc.total} (E:${lc.easy} M:${lc.medium} H:${lc.hard})`);
    });
    
    // Top GitHub contributors
    const topGitHub = results
        .sort((a, b) => (b.data.github.repos + b.data.github.mergedPRs) - (a.data.github.repos + a.data.github.mergedPRs))
        .slice(0, 5);
    
    console.log('\n🐙 GitHub Top 5:');
    topGitHub.forEach((student, index) => {
        const gh = student.data.github;
        console.log(`${index + 1}. ${student.name}: ${gh.repos} repos, ${gh.mergedPRs} merged PRs`);
    });
    
    // Top overall competitive programmers
    const topCP = results
        .sort((a, b) => b.data.totalCP - a.data.totalCP)
        .slice(0, 5);
    
    console.log('\n🏅 Overall CP Top 5:');
    topCP.forEach((student, index) => {
        console.log(`${index + 1}. ${student.name}: ${student.data.totalCP} total problems`);
    });
}

// Run the scraper
if (require.main === module) {
    runScraper().catch(console.error);
}

module.exports = { runScraper, processStudent, Adapters };