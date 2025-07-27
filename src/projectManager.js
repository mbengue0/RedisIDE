const { v4: uuidv4 } = require('uuid');
const { getClient } = require('./redisClient');

class ProjectManager {
    constructor() {
        this.client = null;
    }

    init() {
        this.client = getClient();
    }

    // Create a new project
    async createProject(name, description = '') {
        const projectId = uuidv4();
        const project = {
            id: projectId,
            name,
            description,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            files: {},
            settings: {
                language: 'javascript',
                theme: 'dark'
            }
        };

        try {
            await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
        } catch (error) {
            console.log('RedisJSON not available, using string storage');
            await this.client.set(`project:${projectId}`, JSON.stringify(project));
        }
        
        await this.client.sAdd('projects:list', projectId);
        return project;
    }

    // Get all projects
    async listProjects() {
        const projectIds = await this.client.sMembers('projects:list');
        const projects = [];

        for (const id of projectIds) {
            try {
                const project = await this.getProject(id);
                if (project) {
                    projects.push(project);
                }
            } catch (error) {
                console.error(`Error loading project ${id}:`, error);
            }
        }

        return projects.sort((a, b) => 
            new Date(b.updatedAt) - new Date(a.updatedAt)
        );
    }

    // Get project by ID
    async getProject(projectId) {
        try {
            const result = await this.client.sendCommand(['JSON.GET', `project:${projectId}`]);
            return JSON.parse(result);
        } catch (error) {
            const projectStr = await this.client.get(`project:${projectId}`);
            return projectStr ? JSON.parse(projectStr) : null;
        }
    }

    // Add file to project
    async addFileToProject(projectId, filepath, content = '') {
        const pathParts = filepath.split('/').filter(p => p);
        const filename = pathParts.pop();
        const fileKey = `file:${projectId}:${filepath}`;

        await this.client.hSet(fileKey, {
            content,
            projectId,
            filepath,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            size: Buffer.byteLength(content, 'utf8')
        });

        try {
            const project = await this.getProject(projectId);
            if (!project) throw new Error('Project not found');

            let current = project.files;
            for (let i = 0; i < pathParts.length; i++) {
                const folderName = pathParts[i];
                if (!current[folderName]) {
                    current[folderName] = {
                        type: 'folder',
                        name: folderName,
                        children: {}
                    };
                }
                if (!current[folderName].children) {
                    current[folderName].children = {};
                }
                current = current[folderName].children;
            }
            
            current[filename] = {
                type: 'file',
                name: filename,
                path: filepath,
                size: Buffer.byteLength(content, 'utf8'),
                updatedAt: new Date().toISOString()
            };

            project.updatedAt = new Date().toISOString();
            try {
                await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
            } catch (error) {
                await this.client.set(`project:${projectId}`, JSON.stringify(project));
            }
        } catch (error) {
            console.error('Error updating project structure:', error);
            throw error;
        }

        return { success: true, filepath, fileKey };
    }

    // Create folder in project
    async createFolder(projectId, folderPath) {
        try {
            const project = await this.getProject(projectId);
            if (!project) throw new Error('Project not found');

            const pathParts = folderPath.split('/').filter(p => p);
            let current = project.files;
            
            pathParts.forEach((folder) => {
                if (!current[folder]) {
                    current[folder] = {
                        type: 'folder',
                        name: folder,
                        children: {}
                    };
                }
                current = current[folder].children || {};
            });

            project.updatedAt = new Date().toISOString();
            try {
                await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
            } catch (error) {
                await this.client.set(`project:${projectId}`, JSON.stringify(project));
            }

            return { success: true, folderPath };
        } catch (error) {
            console.error('Error creating folder:', error);
            throw error;
        }
    }

    // Get file from project
    async getFile(projectId, filepath) {
        const fileKey = `file:${projectId}:${filepath}`;
        return await this.client.hGetAll(fileKey);
    }

    // Update file content
    async updateFile(projectId, filepath, content) {
        const fileKey = `file:${projectId}:${filepath}`;
        
        await this.client.hSet(fileKey, {
            content,
            updatedAt: new Date().toISOString(),
            size: Buffer.byteLength(content, 'utf8')
        });

        try {
            const project = await this.getProject(projectId);
            if (project) {
                project.updatedAt = new Date().toISOString();
                try {
                    await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
                } catch (error) {
                    await this.client.set(`project:${projectId}`, JSON.stringify(project));
                }
            }
        } catch (error) {
            console.error('Error updating project timestamp:', error);
        }

        return { success: true, filepath };
    }

    // List all files in a project
    async listProjectFiles(projectId) {
        const pattern = `file:${projectId}:*`;
        const keys = await this.client.keys(pattern);
        const files = [];

        for (const key of keys) {
            const fileData = await this.client.hGetAll(key);
            files.push({
                key,
                filepath: fileData.filepath,
                size: parseInt(fileData.size) || 0,
                updatedAt: fileData.updatedAt
            });
        }

        return files;
    }

    // Delete file from project
    async deleteFile(projectId, filepath) {
        const fileKey = `file:${projectId}:${filepath}`;
        await this.client.del(fileKey);

        try {
            const project = await this.getProject(projectId);
            if (project) {
                const pathParts = filepath.split('/');
                const filename = pathParts.pop();
                let current = project.files;
                for (let i = 0; i < pathParts.length; i++) {
                    if (current[pathParts[i]]) {
                        current = current[pathParts[i]].children || current[pathParts[i]];
                    }
                }
                delete current[filename];
                project.updatedAt = new Date().toISOString();
                try {
                    await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
                } catch (error) {
                    await this.client.set(`project:${projectId}`, JSON.stringify(project));
                }
            }
        } catch (error) {
            console.error('Error removing file from project structure:', error);
        }

        return { success: true };
    }

    // Delete entire project
    async deleteProject(projectId) {
        const files = await this.listProjectFiles(projectId);
        for (const file of files) {
            await this.client.del(file.key);
        }
        await this.client.del(`project:${projectId}`);
        await this.client.sRem('projects:list', projectId);
        return { success: true };
    }

    // Replace the entire renameItem method in projectManager.js
    async renameItem(projectId, oldPath, newPath, isFolder = false) {
        try {
            if (isFolder) {
                // Get all files in the folder
                const allFiles = await this.listProjectFiles(projectId);
                const folderFiles = allFiles.filter(file => 
                    file.filepath.startsWith(oldPath + '/')
                );
                
                // Rename all files in the folder
                for (const file of folderFiles) {
                    const newFilePath = file.filepath.replace(oldPath, newPath);
                    const oldKey = `file:${projectId}:${file.filepath}`;
                    const newKey = `file:${projectId}:${newFilePath}`;
                    
                    const fileData = await this.client.hGetAll(oldKey);
                    if (fileData && Object.keys(fileData).length > 0) {
                        await this.client.hSet(newKey, {
                            ...fileData,
                            filepath: newFilePath,
                            updatedAt: new Date().toISOString()
                        });
                        await this.client.del(oldKey);
                    }
                }
                
                // Update the folder in project structure
                const project = await this.getProject(projectId);
                if (project) {
                    const oldParts = oldPath.split('/').filter(p => p);
                    const newParts = newPath.split('/').filter(p => p);
                    const newFolderName = newParts[newParts.length - 1];
                    
                    // Navigate to the folder and rename it
                    let current = project.files;
                    let parent = null;
                    
                    // Navigate to the parent of the folder being renamed
                    for (let i = 0; i < oldParts.length - 1; i++) {
                        if (current[oldParts[i]]) {
                            parent = current;
                            current = current[oldParts[i]].children || {};
                        }
                    }
                    
                    // Get the folder object
                    const folderToRename = current[oldParts[oldParts.length - 1]];
                    
                    if (folderToRename) {
                        // If renaming at root level
                        if (oldParts.length === 1) {
                            project.files[newFolderName] = folderToRename;
                            delete project.files[oldParts[0]];
                        } else {
                            // If renaming in nested structure
                            parent[oldParts[oldParts.length - 2]].children[newFolderName] = folderToRename;
                            delete parent[oldParts[oldParts.length - 2]].children[oldParts[oldParts.length - 1]];
                        }
                        
                        project.updatedAt = new Date().toISOString();
                        
                        try {
                            await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
                        } catch (error) {
                            await this.client.set(`project:${projectId}`, JSON.stringify(project));
                        }
                    }
                }
            } else {
                // Handle file rename (existing code)
                const oldKey = `file:${projectId}:${oldPath}`;
                const newKey = `file:${projectId}:${newPath}`;
                
                const fileData = await this.client.hGetAll(oldKey);
                if (fileData && Object.keys(fileData).length > 0) {
                    await this.client.hSet(newKey, {
                        ...fileData,
                        filepath: newPath,
                        updatedAt: new Date().toISOString()
                    });
                    await this.client.del(oldKey);
                }
                
                // Update file in project structure
                const project = await this.getProject(projectId);
                if (project) {
                    const oldParts = oldPath.split('/').filter(p => p);
                    const newParts = newPath.split('/').filter(p => p);
                    const newFileName = newParts[newParts.length - 1];
                    
                    // Navigate to the file and rename it
                    let current = project.files;
                    
                    // Navigate to parent folder
                    for (let i = 0; i < oldParts.length - 1; i++) {
                        if (current[oldParts[i]]) {
                            current = current[oldParts[i]].children || {};
                        }
                    }
                    
                    // Get the file object
                    const fileToRename = current[oldParts[oldParts.length - 1]];
                    
                    if (fileToRename) {
                        fileToRename.path = newPath;
                        fileToRename.name = newFileName;
                        current[newFileName] = fileToRename;
                        delete current[oldParts[oldParts.length - 1]];
                        
                        project.updatedAt = new Date().toISOString();
                        
                        try {
                            await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
                        } catch (error) {
                            await this.client.set(`project:${projectId}`, JSON.stringify(project));
                        }
                    }
                }
            }
            
            return { success: true, oldPath, newPath };
        } catch (error) {
            console.error('Error renaming item:', error);
            throw error;
        }
    }

    // Replace the entire deleteFolder method in projectManager.js
    async deleteFolder(projectId, folderPath) {
        try {
            // Get all files in the folder
            const allFiles = await this.listProjectFiles(projectId);
            const folderFiles = allFiles.filter(file => 
                file.filepath.startsWith(folderPath + '/')
            );
            
            // Delete all files
            for (const file of folderFiles) {
                await this.client.del(file.key);
            }
            
            // Now remove the folder from project structure
            const project = await this.getProject(projectId);
            if (project) {
                const pathParts = folderPath.split('/').filter(p => p);
                
                if (pathParts.length === 1) {
                    // Root level folder
                    delete project.files[pathParts[0]];
                } else {
                    // Nested folder - navigate to parent and delete
                    let current = project.files;
                    for (let i = 0; i < pathParts.length - 1; i++) {
                        if (current[pathParts[i]] && current[pathParts[i]].children) {
                            current = current[pathParts[i]].children;
                        }
                    }
                    delete current[pathParts[pathParts.length - 1]];
                }
                
                project.updatedAt = new Date().toISOString();
                
                try {
                    await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
                } catch (error) {
                    await this.client.set(`project:${projectId}`, JSON.stringify(project));
                }
            }
            
            return { success: true, deletedCount: folderFiles.length };
        } catch (error) {
            console.error('Error deleting folder:', error);
            throw error;
        }
    }

    // Rebuild project structure from files
    async updateProjectStructure(projectId) {
        try {
            const project = await this.getProject(projectId);
            if (!project) return;
            
            project.files = {};
            const files = await this.listProjectFiles(projectId);
            
            files.forEach(file => {
                const parts = file.filepath.split('/');
                let current = project.files;
                
                parts.forEach((part, index) => {
                    if (index === parts.length - 1) {
                        current[part] = {
                            type: 'file',
                            name: part,
                            path: file.filepath,
                            size: file.size,
                            updatedAt: file.updatedAt
                        };
                    } else {
                        if (!current[part]) {
                            current[part] = {
                                type: 'folder',
                                name: part,
                                children: {}
                            };
                        }
                        current = current[part].children;
                    }
                });
            });
            
            project.updatedAt = new Date().toISOString();
            try {
                await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
            } catch (error) {
                await this.client.set(`project:${projectId}`, JSON.stringify(project));
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error updating project structure:', error);
            throw error;
        }
    }

    // Rename project
    async renameProject(projectId, newName) {
        try {
            const project = await this.getProject(projectId);
            if (!project) throw new Error('Project not found');
            
            project.name = newName;
            project.updatedAt = new Date().toISOString();
            
            try {
                await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
            } catch (error) {
                await this.client.set(`project:${projectId}`, JSON.stringify(project));
            }
            
            return { success: true, project };
        } catch (error) {
            console.error('Error renaming project:', error);
            throw error;
        }
    }
}

module.exports = new ProjectManager();