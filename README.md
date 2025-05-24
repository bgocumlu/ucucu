# Development Guide

## Local Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/bgocumlu/ephchat.git
   cd ephchat
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the WebSocket server**
   ```bash
   npm run ws
   ```
   - The server listens on `ws://localhost:3001` by default.

4. **Start the Next.js app**
   ```bash
   npm run dev
   ```
   - The app runs on [http://localhost:3000](http://localhost:3000)

---

## Cloud Deployment

- **Frontend:** Deploy the Next.js app to Vercel or any platform supporting Next.js.
- **WebSocket Server:**
  - Use a service like Render, Railway, or a VPS (AWS EC2, DigitalOcean, etc.).
  - Ensure the server listens on `0.0.0.0`:
    ```js
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`WebSocket server running on port ${PORT}`);
    });
    ```
  - Update the client WebSocket URL to your public address (e.g., `wss://your-domain.com`).

---