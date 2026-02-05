# Automated Web Scraping System for 10k+ Students

A high-performance, production-ready web scraping system designed to collect competitive programming and development statistics from multiple platforms for large-scale student datasets.

## 🚀 Features

- **High Concurrency**: Process 200-500 students per batch with 10-20 concurrent workers
- **Intelligent Retry**: Exponential backoff retry mechanism for failed requests
- **Smart Caching**: 24-hour cache to avoid redundant API calls
- **Rate Limiting**: Built-in rate limiting to respect API limits
- **Error Handling**: Robust error handling with graceful degradation
- **Real-time Progress**: Live progress tracking and performance metrics
- **Multiple Platforms**: LeetCode, GitHub, Codeforces, AtCoder support
- **Detailed Analytics**: Comprehensive statistics and leaderboard generation

## 📊 Supported Platforms & Metrics

### LeetCode
- Total problems solved
- Easy/Medium/Hard problem breakdown
- Submission statistics

### GitHub  
- Public repository count
- Merged pull requests count
- Profile activity metrics

### Codeforces
- Total problems solved
- Contest participation data

### AtCoder
- Total problems solved
- Rating and contest history

## 🛠️ Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd web_scrap-main
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables (optional)**
```bash
# Create .env file for GitHub API token (recommended for higher rate limits)
echo "GITHUB_TOKEN=your_github_token_here" > .env
```

## 📋 Configuration

Edit the configuration in `scraper.js`:

```javascript
const CONFIG = {
    BATCH_SIZE: 300,        // Students per batch (200-500 recommended)
    CONCURRENCY: 15,        // Concurrent workers (10-20 recommended)
    RETRY_ATTEMPTS: 3,      // Number of retry attempts
    RETRY_DELAY: 2000,      // Base retry delay in ms
    CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours
    REQUEST_TIMEOUT: 15000, // Request timeout in ms
    RATE_LIMIT_DELAY: 100   // Delay between requests in ms
};
```

## 🚦 Usage

### 1. Test the System (Recommended)
```bash
npm test
```
This will test the system with a small sample to ensure everything works correctly.

### 2. Run Full Scraping
```bash
npm start
```

### 3. Generate Statistics
```bash
npm run stats
```

### 4. Clean Cache (if needed)
```bash
npm run clean-cache
```

## 📁 Input Data Format

Ensure your `students_mock.json` follows this format:

```json
[
  {
    "id": 1,
    "name": "STUDENT NAME",
    "handles": {
      "leetcode": "leetcode_username",
      "github": "github_username", 
      "codeforces": "codeforces_username",
      "atcoder": "atcoder_username"
    }
  }
]
```

## 📈 Output Files

### `results.json`
Complete raw data for all students:
```json
{
  "id": 1,
  "name": "STUDENT NAME",
  "data": {
    "leetcode": {
      "total": 150,
      "easy": 80,
      "medium": 60,
      "hard": 10
    },
    "github": {
      "repos": 25,
      "mergedPRs": 15
    },
    "codeforces": {
      "solved": 45
    },
    "atcoder": {
      "solved": 20
    },
    "totalCP": 215
  },
  "processingTime": 2340,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### `leaderboard.json` & `leaderboard.csv`
Ranked student data with scoring system for easy analysis and Excel import.

### `summary.json`
High-level statistics and insights.

## ⚡ Performance Metrics

- **Target Speed**: <2.5 seconds per student
- **Batch Processing**: 200-500 students per batch
- **Concurrent Workers**: 10-20 simultaneous requests
- **Success Rate**: >95% with retry mechanisms
- **Memory Efficient**: Processes data in batches to handle 10k+ students

## 🔧 Advanced Configuration

### GitHub API Token Setup
1. Go to GitHub Settings > Developer settings > Personal access tokens
2. Generate a new token with `public_repo` scope
3. Add to environment: `GITHUB_TOKEN=your_token_here`

### Custom Scoring System
Modify the scoring weights in `stats.js`:
```javascript
const weights = {
    leetcode: 1.0,
    github_repos: 2.0,
    github_prs: 3.0,
    codeforces: 1.2,
    atcoder: 1.2
};
```

## 🛡️ Error Handling

The system includes comprehensive error handling:
- **Network timeouts**: Automatic retry with exponential backoff
- **API rate limits**: Built-in rate limiting and respect for API limits
- **Invalid usernames**: Graceful handling with default values
- **Partial failures**: Continue processing other students if some fail

## 📊 Monitoring & Logging

Real-time progress tracking includes:
- Batch processing status
- Individual student processing times
- Success/failure rates
- Performance metrics
- Top performers display

## 🔄 Migration to Excel

After testing with JSON output:
1. Use the generated `leaderboard.csv` file
2. Import directly into Excel/Google Sheets
3. Use the statistics for further analysis

## 🚨 Important Notes

- **Rate Limits**: Respect platform API limits to avoid IP blocking
- **Caching**: 24-hour cache reduces redundant requests
- **Testing**: Always test with small samples before full runs
- **Monitoring**: Monitor progress and check for errors during execution
- **Backup**: Results are saved incrementally to prevent data loss

## 🤝 Contributing

1. Test thoroughly with small datasets
2. Maintain backward compatibility
3. Update documentation for new features
4. Follow existing code style and patterns

## 📞 Support

For issues or questions:
1. Check the test results first: `npm test`
2. Review error logs in console output
3. Verify input data format
4. Check network connectivity and API availability

---

**Ready to process 10k+ students efficiently!** 🎉