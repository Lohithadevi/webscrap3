const fs = require('fs-extra');
const path = require('path');

async function generateStats() {
    try {
        const results = await fs.readJson(path.join(__dirname, 'results.json'));
        
        // Generate leaderboard
        const leaderboard = results
            .map(student => ({
                name: student.name,
                leetcode: student.data.leetcode.total,
                github_repos: student.data.github.repos,
                github_prs: student.data.github.mergedPRs,
                codeforces: student.data.codeforces.solved,
                atcoder: student.data.atcoder.solved,
                skillrack: student.data.skillrack.solved || 0,
                totalCP: student.data.totalCP,
                score: calculateScore(student.data)
            }))
            .sort((a, b) => b.score - a.score);

        // Save leaderboard
        await fs.writeJson(path.join(__dirname, 'leaderboard.json'), leaderboard, { spaces: 2 });
        
        // Generate CSV
        const csvHeader = 'Rank,Name,Score,LeetCode,GitHub Repos,GitHub PRs,Codeforces,AtCoder,SkillRack,Total CP\n';
        const csvRows = leaderboard.map((student, index) => 
            `${index + 1},${student.name},${student.score},${student.leetcode},${student.github_repos},${student.github_prs},${student.codeforces},${student.atcoder},${student.skillrack},${student.totalCP}`
        ).join('\n');
        
        await fs.writeFile(path.join(__dirname, 'leaderboard.csv'), csvHeader + csvRows);
        
        console.log('✅ Statistics generated successfully!');
        console.log(`📊 Leaderboard saved: leaderboard.json & leaderboard.csv`);
        
    } catch (error) {
        console.error('❌ Error generating statistics:', error.message);
        process.exit(1);
    }
}

function calculateScore(data) {
    const weights = {
        leetcode: 1.0,
        github_repos: 2.0,
        github_prs: 3.0,
        codeforces: 1.2,
        atcoder: 1.2,
        skillrack: 1.0
    };
    
    return Math.round(
        data.leetcode.total * weights.leetcode +
        data.github.repos * weights.github_repos +
        data.github.mergedPRs * weights.github_prs +
        data.codeforces.solved * weights.codeforces +
        data.atcoder.solved * weights.atcoder +
        (data.skillrack.solved || 0) * weights.skillrack
    );
}

generateStats();