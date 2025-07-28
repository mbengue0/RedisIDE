const { getClient } = require('./redisClient');

class SearchManager {
    constructor() {
        this.client = null;
        this.indexName = 'idx:code';
        this.docPrefix = 'doc:';
    }

    init() {
        this.client = getClient();
    }

    async createSearchIndex() {
        try {
            // Drop existing index if it exists
            try {
                await this.client.sendCommand(['FT.DROPINDEX', this.indexName, 'DD']);
            } catch (err) {
                // Index doesn't exist, that's fine
            }

            // Create the search index with proper schema
            await this.client.sendCommand([
                'FT.CREATE', this.indexName,
                'ON', 'HASH',
                'PREFIX', '1', this.docPrefix,
                'SCHEMA',
                'projectId', 'TAG',
                'filepath', 'TEXT', 'WEIGHT', '2.0',
                'filename', 'TEXT', 'WEIGHT', '3.0',
                'extension', 'TAG',
                'content', 'TEXT',
                'language', 'TAG',
                'size', 'NUMERIC',
                'updatedAt', 'TEXT'
            ]);

            console.log('✅ RediSearch index created successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to create search index:', error);
            // If RediSearch is not available, we'll fall back to basic search
            return false;
        }
    }

    async indexFile(projectId, filepath, content) {
        try {
            const docId = `${this.docPrefix}${projectId}:${filepath}`;
            const filename = filepath.split('/').pop();
            const extension = filename.split('.').pop();
            const language = this.getLanguageFromExtension(extension);

            await this.client.hSet(docId, {
                projectId,
                filepath,
                filename,
                extension,
                content,
                language,
                size: Buffer.byteLength(content, 'utf8'),
                updatedAt: new Date().toISOString()
            });

            console.log(`📄 Indexed: ${filepath}`);
            return true;
        } catch (error) {
            console.error('Error indexing file:', error);
            return false;
        }
    }

    async searchCode(query, options = {}) {
        const { 
            projectId = null, 
            limit = 20, 
            offset = 0, 
            highlight = true,
            extensions = null 
        } = options;

        try {
            // Build search query
            let searchQuery = query;
            
            // Add project filter if specified
            if (projectId) {
                searchQuery = `@projectId:{${projectId}} ${searchQuery}`;
            }
            
            // Add extension filter if specified
            if (extensions && extensions.length > 0) {
                const extFilter = extensions.map(ext => `@extension:{${ext}}`).join('|');
                searchQuery = `(${extFilter}) ${searchQuery}`;
            }

            // Prepare search command
            const searchCmd = [
                'FT.SEARCH', this.indexName, searchQuery,
                'LIMIT', offset.toString(), limit.toString(),
                'WITHSCORES'
            ];

            // Add highlighting if requested
            if (highlight) {
                searchCmd.push(
                    'HIGHLIGHT',
                    'FIELDS', '1', 'content',
                    'TAGS', '<mark>', '</mark>'
                );
            }

            // Execute search
            const results = await this.client.sendCommand(searchCmd);
            
            // Parse results
            const total = results[0];
            const documents = [];
            
            for (let i = 1; i < results.length; i += 2) {
                const docId = results[i];
                const fields = results[i + 1];
                
                // Convert array to object
                const doc = {};
                for (let j = 0; j < fields.length; j += 2) {
                    doc[fields[j]] = fields[j + 1];
                }
                
                // Create snippet if highlighting wasn't used
                if (!highlight && doc.content) {
                    const index = doc.content.toLowerCase().indexOf(query.toLowerCase());
                    if (index !== -1) {
                        const start = Math.max(0, index - 100);
                        const end = Math.min(doc.content.length, index + query.length + 100);
                        doc.snippet = doc.content.substring(start, end);
                        if (start > 0) doc.snippet = '...' + doc.snippet;
                        if (end < doc.content.length) doc.snippet += '...';
                    }
                }
                
                documents.push({
                    ...doc,
                    key: docId,
                    score: results[i - 1] // Include relevance score
                });
            }

            return {
                total,
                documents,
                query,
                offset,
                limit,
                fallback: false
            };

        } catch (error) {
            console.error('RediSearch error, falling back to basic search:', error);
            // Fall back to basic search
            return await this.basicSearch(query, options);
        }
    }

    async searchInProject(projectId, query, options = {}) {
        return await this.searchCode(query, { ...options, projectId });
    }

    // Fallback basic search (what we implemented earlier)
    async basicSearch(query, options = {}) {
        // ... (the simple search we implemented before)
        const { projectId = null, limit = 20, offset = 0 } = options;
        
        const pattern = projectId ? `file:${projectId}:*` : 'file:*';
        const keys = await this.client.keys(pattern);
        const results = [];
        const queryLower = query.toLowerCase();

        for (const key of keys) {
            const fileData = await this.client.hGetAll(key);
            
            if (fileData.content && fileData.content.toLowerCase().includes(queryLower)) {
                const keyParts = key.split(':');
                const projectId = keyParts[1];
                const filepath = keyParts.slice(2).join(':');
                
                const content = fileData.content;
                const index = content.toLowerCase().indexOf(queryLower);
                const start = Math.max(0, index - 50);
                const end = Math.min(content.length, index + query.length + 50);
                
                let snippet = content.substring(start, end);
                if (start > 0) snippet = '...' + snippet;
                if (end < content.length) snippet = snippet + '...';
                
                const regex = new RegExp(`(${query})`, 'gi');
                snippet = snippet.replace(regex, '<mark>$1</mark>');
                
                results.push({
                    key,
                    filepath: filepath || fileData.filepath,
                    content: snippet,
                    projectId,
                    filename: filepath ? filepath.split('/').pop() : ''
                });
            }
        }

        return {
            total: results.length,
            documents: results.slice(offset, offset + limit),
            query,
            offset,
            limit,
            fallback: true
        };
    }

    // Helper function to determine language from file extension
    getLanguageFromExtension(ext) {
        const languageMap = {
            'js': 'javascript',
            'jsx': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'py': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'cs': 'csharp',
            'php': 'php',
            'rb': 'ruby',
            'go': 'go',
            'rs': 'rust',
            'swift': 'swift',
            'kt': 'kotlin',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'json': 'json',
            'xml': 'xml',
            'md': 'markdown',
            'sql': 'sql',
            'sh': 'bash',
            'yml': 'yaml',
            'yaml': 'yaml'
        };
        return languageMap[ext] || 'plaintext';
    }

    // Method to reindex all files (useful for migrations)
    async reindexAllFiles() {
        try {
            await this.createSearchIndex();
            
            const keys = await this.client.keys('file:*');
            let indexed = 0;
            
            for (const key of keys) {
                const fileData = await this.client.hGetAll(key);
                if (fileData.content) {
                    const keyParts = key.split(':');
                    const projectId = keyParts[1];
                    const filepath = keyParts.slice(2).join(':');
                    
                    await this.indexFile(projectId, filepath, fileData.content);
                    indexed++;
                }
            }
            
            console.log(`✅ Reindexed ${indexed} files`);
            return indexed;
        } catch (error) {
            console.error('Error reindexing files:', error);
            throw error;
        }
    }
}

module.exports = new SearchManager();