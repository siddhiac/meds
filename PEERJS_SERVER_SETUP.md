# PeerJS Server Setup Guide

This document explains how to set up your own PeerJS signaling server for the P2P sync feature.

## Why Self-Host?

While the app currently uses the public PeerJS cloud server for convenience, self-hosting provides:
- **Better Privacy**: Your signaling data doesn't go through a third party
- **More Control**: No dependency on external services
- **Better Reliability**: No rate limits or service interruptions
- **Medical Data Compliance**: Keep all signaling on your own infrastructure

## Quick Start with Docker (Recommended)

The easiest way to run a PeerJS server is using Docker:

```bash
docker run -d \
  --name peerjs-server \
  -p 9000:9000 \
  peerjs/peerjs-server:latest \
  --port 9000 \
  --path /myapp
```

This starts a PeerJS server on port 9000 with path `/myapp`.

## Manual Installation (Node.js)

### Prerequisites
- Node.js 14 or higher
- npm or yarn

### Steps

1. **Install PeerJS Server globally**:
```bash
npm install -g peer
```

2. **Run the server**:
```bash
peerjs --port 9000 --path /myapp
```

### Running as a Service

For production, you'll want the server to run as a service. Here's a systemd service file:

**Create `/etc/systemd/system/peerjs.service`**:
```ini
[Unit]
Description=PeerJS Signaling Server
After=network.target

[Service]
Type=simple
User=peerjs
WorkingDirectory=/home/peerjs
ExecStart=/usr/bin/peerjs --port 9000 --path /myapp
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and start**:
```bash
sudo systemctl enable peerjs
sudo systemctl start peerjs
sudo systemctl status peerjs
```

## Custom Node.js Server

For more control, you can embed PeerJS server in your own Node.js app:

**server.js**:
```javascript
const { PeerServer } = require('peer');

const peerServer = PeerServer({
  port: 9000,
  path: '/myapp',

  // Optional: Add SSL for HTTPS
  ssl: {
    key: fs.readFileSync('/path/to/key.pem'),
    cert: fs.readFileSync('/path/to/cert.pem')
  },

  // Optional: Enable CORS if needed
  allow_discovery: true
});

peerServer.on('connection', (client) => {
  console.log('Client connected:', client.getId());
});

peerServer.on('disconnect', (client) => {
  console.log('Client disconnected:', client.getId());
});

console.log('PeerJS server running on port 9000');
```

**Run it**:
```bash
node server.js
```

## Nginx Reverse Proxy (Recommended for Production)

If you're running PeerJS behind Nginx:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /myapp {
        proxy_pass http://localhost:9000/myapp;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Important for WebRTC
        proxy_read_timeout 86400;
    }
}
```

## Configuring the App

Once your server is running, update the PeerJS configuration in `app.js`:

**Find this section** (around line 40):
```javascript
this.peer = new Peer(this.roomId, {
    // Uncomment and configure when you have your own PeerJS server:
    // host: 'your-peerjs-server.com',
    // port: 9000,
    // path: '/myapp'
});
```

**Update to**:
```javascript
this.peer = new Peer(this.roomId, {
    host: 'your-domain.com',  // Your server domain
    port: 443,                 // HTTPS port (or 9000 for HTTP)
    path: '/myapp',            // Same as server config
    secure: true               // Use SSL
});
```

**For local network** (e.g., home WiFi):
```javascript
this.peer = new Peer(this.roomId, {
    host: '192.168.1.100',     // Your server's local IP
    port: 9000,
    path: '/myapp',
    secure: false              // No SSL on local network
});
```

## Cloud Deployment Options

### DigitalOcean Droplet ($5/month)
1. Create a droplet with Ubuntu
2. Install Docker
3. Run the Docker command above
4. Point your domain to the droplet's IP
5. Set up SSL with Let's Encrypt

### AWS EC2 (Free tier available)
1. Launch a t2.micro instance
2. Install Node.js and PeerJS
3. Configure security groups to allow port 9000
4. Use Elastic IP for consistent address

### Heroku (Free tier available)
1. Create a new Heroku app
2. Deploy the Node.js server code
3. The app URL becomes your host

### VPS at Home
If you have a static IP or dynamic DNS:
1. Run PeerJS on a Raspberry Pi or old computer
2. Forward port 9000 on your router
3. Use dynamic DNS service (like DuckDNS) if needed

## Security Considerations

### For Medical Data:
1. **Always use SSL/TLS** in production
2. **Firewall rules**: Only allow necessary ports
3. **Rate limiting**: Prevent abuse
4. **Logging**: Monitor connection attempts
5. **Authentication**: Consider adding API keys

### Example with API Key:
```javascript
const peerServer = PeerServer({
  port: 9000,
  path: '/myapp',
  allow_discovery: false,

  // Custom authentication
  generateClientId: () => {
    return Math.random().toString(36).substr(2, 9);
  }
});
```

## Testing Your Server

Test the server is working:

```bash
curl http://your-domain.com:9000/myapp
```

Should return:
```json
{"name":"PeerJS Server"}
```

## Monitoring

Monitor your PeerJS server with:

```javascript
peerServer.on('connection', (client) => {
  console.log(`${new Date().toISOString()} - Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`${new Date().toISOString()} - Client disconnected: ${client.getId()}`);
});

peerServer.on('error', (error) => {
  console.error(`${new Date().toISOString()} - Server error:`, error);
});
```

## Troubleshooting

### Connections failing?
- Check firewall allows port 9000
- Verify SSL certificates if using HTTPS
- Check CORS settings
- Verify path matches in both server and client

### Slow connections?
- Check server resources (CPU/RAM)
- Consider using a CDN for STUN servers
- Increase proxy timeouts in Nginx

### Can't connect from outside network?
- Port forwarding configured correctly?
- Firewall allows incoming connections?
- Using correct public IP/domain?

## Default Configuration (Using PeerJS Cloud)

If you choose not to self-host, the app will use the default PeerJS cloud server:
- No setup required
- Works out of the box
- Good for testing
- **Not recommended for production/medical data**

The cloud server is maintained by PeerJS and is free but has no SLA guarantees.

## Summary

For a **home caregiver setup**:
- Use Docker on a Raspberry Pi at home
- Connect all devices to same WiFi
- No SSL needed (local network only)
- Total cost: ~$35 for a Raspberry Pi

For **production/HIPAA compliance**:
- Use a VPS with SSL
- Enable authentication
- Monitor logs
- Backup configuration
- Total cost: ~$5-10/month

## Support

For PeerJS server issues, see:
- GitHub: https://github.com/peers/peerjs-server
- Documentation: https://peerjs.com/docs.html

For app-specific sync issues, check the browser console for WebRTC errors.
