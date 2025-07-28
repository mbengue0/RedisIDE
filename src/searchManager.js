const { getClient } = require('./redisClient');

class SearchManager {
    constructor() {
        this.client = null;
    }

    init() {
        this.client = getClient();
    }

    async searchCode(query, options = {}) {
        const { projectId = null, limit = 20, offset = 0 } = options;
        
        try {
            // Get all file keys
            const pattern = projectId ? `file:${projectId}:*` : 'file:*';
            const keys = await this.client.keys(pattern);
            const results = [];
            const queryLower = query.toLowerCase();

            // Search through each file
            for (const key of keys) {
                const fileData = await this.client.hGetAll(key);
                
                if (fileData.content && fileData.content.toLowerCase().includes(queryLower)) {
                    // Extract filepath and projectId from key
                    const keyParts = key.split(':');
                    const projectId = keyParts[1];
                    const filepath = keyParts.slice(2).join(':');
                    
                    // Find matches and create snippets
                    const content = fileData.content;
                    const index = content.toLowerCase().indexOf(queryLower);
                    const start = Math.max(0, index - 50);
                    const end = Math.min(content.length, index + query.length + 50);
                    
                    let snippet = content.substring(start, end);
                    
                    // Add ellipsis if truncated
                    if (start > 0) snippet = '...' + snippet;
                    if (end < content.length) snippet = snippet + '...';
                    
                    // Highlight matches
                    const regex = new RegExp(`(${query})`, 'gi');
                    snippet = snippet.replace(regex, '<mark>$1</mark>');
                    
                    results.push({
                        key,
                        filepath: filepath || fileData.filepath,
                        content: snippet,
                        projectId,
                        filename: filepath ? filepath.split('/').pop() : '',
                        extension: filepath ? filepath.split('.').pop() : ''
                    });
                }
            }

            // Apply pagination
            const paginatedResults = results.slice(offset, offset + limit);

            return {
                total: results.length,
                documents: paginatedResults,
                query,
                offset,
                limit,
                fallback: true
            };
        } catch (error) {
            console.error('Search error:', error);
            return {
                total: 0,
                documents: [],
                query,
                offset,
                limit,
                error: error.message
            };
        }
    }

    async searchInProject(projectId, query, options = {}) {
        return await this.searchCode(query, { ...options, projectId });
    }
}

module.exports = new SearchManager();