# Redis IDE - A Full-Featured Web IDE Powered by Redis


![Redis IDE Banner](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

A complete web-based Integrated Development Environment (IDE) built entirely on Redis, showcasing its capabilities far beyond caching. This project demonstrates how Redis can power complex, real-time applications with features like collaborative editing, version control, and AI assistance.

🏆 **Submission for the Redis "Beyond the Cache" Hackathon**

## 🌐 Live Demo

[Try Redis IDE Live](https://rediside-production.up.railway.app/?session=collab-1pi4o56bb)

## 🎥 Demo Video

[Watch Demo Video](https://www.youtube.com/watch?v=SDGxXBB2Leg)

## ✨ Features

### 🚀 Core Features
- **Monaco Editor Integration** - VS Code's powerful editor in your browser
- **Multi-file Support** - Work with multiple files and tabs simultaneously
- **20+ Language Support** - Syntax highlighting for all major languages
- **File Management** - Create, edit, delete, and organize files/folders
- **Drag & Drop** - Intuitive file organization
- **Project Management** - Create and manage multiple projects
- **Custom Theme Support** - Switch between light/dark themes for better usability

### 👥 Real-time Collaboration
- **Live Cursors** - See where others are typing in real-time
- **Instant Sync** - Code changes sync across all connected users
- **User Presence** - See who's currently working on the project
- **Shared Selections** - View what others are selecting
- **Chat Integration** - Communicate with collaborators directly in the IDE

### 🌿 Git Version Control
- **Built on Redis** - Complete Git implementation without using Git
- **Branches** - Create, checkout, and merge branches
- **Commits** - Stage files and commit with messages
- **History** - View commit history with diffs
- **File Tracking** - Track changes, additions, and deletions

### 🤖 AI Assistant
- **Code Analysis** - Find bugs and performance issues
- **Code Explanation** - Understand complex code
- **Refactoring** - Modernize and simplify code
- **Documentation** - Generate comments and docs
- **Powered by Groq** - Fast AI responses
- **AI Code Completion** - Suggest code snippets based on context

### 🔍 Advanced Search
- **Full-text Search** - Search across all files and projects
- **Redis Search** - Powered by RediSearch module
- **Instant Results** - Sub-second search performance

### 💻 Integrated Terminal
- **Command Execution** - Run commands directly in the IDE
- **Output Display** - See results without leaving the editor

## 🏗️ Architecture
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Vanilla JS)                 │
│  Monaco Editor | WebSocket | Real-time Collaboration     │
└────────────────────────┬────────────────────────────────┘
│ HTTP + WebSocket
┌────────────────────────┴────────────────────────────────┐
│                  Backend (Node.js + Express)             │
│   Project Manager | Git Engine | Search | Collaboration  │
└────────────────────────┬────────────────────────────────┘
│ Redis Protocol
┌────────────────────────┴────────────────────────────────┐
│                        Redis 8                           │
│  JSON | Hashes | Lists | Sets | Pub/Sub | Search | TTL  │
└─────────────────────────────────────────────────────────┘

## 🚀 How Redis Powers Everything

### 1. **File System (RedisJSON)**
```javascript
// Complete project structure stored as JSON
project:projectId -> {
  name: "My Project",
  files: {
    "src": {
      type: "folder",
      children: {
        "index.js": {
          type: "file",
          content: "console.log('Hello Redis!');"
        }
      }
    }
  }
}
```

### 2. **Git Version Control**
- **Commits**: Redis Hashes store commit metadata
- **Branches**: Redis Hashes map branch names to HEAD commits
- **History**: Redis Lists maintain commit order per branch
- **File Snapshots**: Redis Hashes store file states at each commit

### 3. **Real-time Collaboration**
- **Pub/Sub**: Instant code synchronization
- **Sets**: Track active users per project
- **Hashes**: Store cursor positions and selections

### 4. **Search (RediSearch)**
- Full-text indexing of all code files
- Sub-millisecond search across projects

## 🛠️ Installation

### **Prerequisites**
- Node.js 16+
- Redis 8 with RediSearch module
- Groq API key (for AI features)

### **Local Development**

1. Clone the repository:
```bash
git clone https://github.com/mbengue0/RedisIDE.git
cd redis-ide
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```env
REDIS_URL=redis://localhost:6379
GROQ_API_KEY=your_groq_api_key
PORT=3000
```

4. Start the server:
```bash
npm start
```

5. Open [http://localhost:3000](http://localhost:3000)

### **Docker Deployment**
```bash
docker-compose up
```

## 🌐 Deployment

### **Railway.app (Recommended)**
1. Fork this repository
2. Connect Railway to your GitHub
3. Add environment variables
4. Deploy!

### **Environment Variables**
- `REDIS_URL` - Your Redis connection string
- `GROQ_API_KEY` - Groq API key for AI features
- `PORT` - Server port (default: 3000)

## 🔧 Technology Stack
- **Frontend**: Vanilla JavaScript, Monaco Editor
- **Backend**: Node.js, Express.js
- **Database**: Redis 8 (JSON, Search, Pub/Sub)
- **Real-time**: Socket.IO
- **AI**: Groq API
- **Deployment**: Railway

## 📊 Performance Metrics
- **File Access**: < 1ms average latency
- **Search**: < 50ms for project-wide searches
- **Collaboration Sync**: < 100ms for code updates
- **Memory Efficiency**: ~10MB per active project

## 🤝 Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments
- Redis team for the amazing database
- Monaco Editor team at Microsoft
- Groq for the fast AI API
- All contributors and testers

## 🏆 Hackathon Submission
This project demonstrates that Redis is not just a cache, but a powerful multi-model database capable of powering complex applications. By leveraging Redis's various data structures and modules, we've built a complete IDE that would traditionally require multiple databases and services.

### **Key Innovations**
- **Git without Git**: Complete version control using only Redis data structures
- **Real-time without complexity**: Instant collaboration using Redis Pub/Sub
- **Search without Elasticsearch**: Full-text search using RediSearch
- **File system without disk**: Complete file management in Redis

Built with ❤️ and Redis for the "Beyond the Cache" Hackathon