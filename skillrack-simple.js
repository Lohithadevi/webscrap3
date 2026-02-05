const axios = require('axios');

// Simple SkillRack scraper for the web scraping system
async function scrapeSkillRack(skillrackData, rateLimiter) {
    if (!skillrackData) return { solved: 0, userInfo: null };
    
    // Handle both old format (string) and new format (object)
    let username, id, key;
    if (typeof skillrackData === 'string') {
        username = skillrackData;
        id = skillrackData;
        key = null;
    } else {
        username = skillrackData.username;
        id = skillrackData.id;
        key = skillrackData.key;
    }
    
    if (!username) return { solved: 0, userInfo: null };
    
    await rateLimiter.wait();
    
    try {
        console.log(`🔍 Scraping SkillRack for: ${username}`);
        
        // Build URL with proper parameters
        let profileUrl;
        if (id && key) {
            profileUrl = `https://www.skillrack.com/faces/resume.xhtml?id=${id}&key=${key}`;
            console.log(`✅ Using mapped profile URL for ${username} (ID: ${id})`);
        } else {
            profileUrl = `https://www.skillrack.com/faces/resume.xhtml?id=${username}`;
            console.log(`⚠️  No mapping found for ${username}, using fallback method`);
        }
        
        // Method 1: Try direct profile access
        let response;
        try {
            response = await axios.get(profileUrl, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Referer': 'https://www.skillrack.com/'
                }
            });
        } catch (error) {
            console.log(`⚠️  Direct access failed for ${username}: ${error.message}`);
            return { solved: 0, userInfo: null };
        }
        
        const html = response.data;
        
        // Basic validation - be less strict about login mentions
        if (!html || html.length < 1000 || 
            html.includes('Please login') || html.includes('Login required') ||
            html.includes('error') || html.includes('Error')) {
            console.log(`⚠️  Invalid response for ${username}`);
            return { solved: 0, userInfo: null };
        }
        
        // Extract user info
        let userInfo = null;
        const nameMatch = html.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
        if (nameMatch && nameMatch[1] && !nameMatch[1].includes('SkillRack')) {
            userInfo = {
                name: nameMatch[1].trim(),
                profileFound: true
            };
        }
        
        // Extract problem count with SkillRack-specific patterns
        let solved = 0;
        const patterns = [
            /<div class="statistic">\s*<div class="value">\s*<i[^>]*><\/i>(\d+)\s*<\/div>\s*<div class="label">\s*PROGRAMS SOLVED\s*<\/div>/i,
            /PROGRAMS SOLVED[\s\S]*?<\/i>(\d+)/i,
            /Programs?\s*Solved[:\s]*([0-9,]+)/i,
            /Solved[:\s]*([0-9,]+)\s*Programs?/i
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                const num = parseInt(match[1].replace(/,/g, ''));
                if (num > 0 && num < 3000 && num !== 2024 && num !== 2023) {
                    solved = num;
                    console.log(`✅ Found ${solved} problems for ${username}`);
                    break;
                }
            }
        }
        
        // If no pattern matched but we have a valid profile, try to find any reasonable number
        if (solved === 0 && userInfo) {
            const numbers = html.match(/\b([0-9]{1,4})\b/g);
            if (numbers) {
                const validNumbers = numbers
                    .map(n => parseInt(n))
                    .filter(n => n > 0 && n < 2000 && n !== 2024 && n !== 2023 && n !== 100 && n !== 200)
                    .sort((a, b) => b - a);
                
                if (validNumbers.length > 0) {
                    solved = validNumbers[0];
                    console.log(`✅ Found ${solved} problems for ${username} (contextual)`);
                }
            }
        }
        
        return {
            solved,
            userInfo: userInfo || { name: username, profileFound: false }
        };
        
    } catch (error) {
        console.log(`❌ SkillRack error for ${username}: ${error.message}`);
        return { solved: 0, userInfo: null };
    }
}

module.exports = { scrapeSkillRack };