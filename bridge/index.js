import express from "express";
import http from "http";

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "default_secret";
const PORT = process.env.PORT || 3000;

let commandQueue = [];

// 发送指令到队列（聊天前端/PWA 调用）
app.post("/toy-next", (req, res) => {
  const { secret, commands } = req.body;
  if (secret !== SECRET) {
    return res.status(403).json({ error: "invalid secret" });
  }
  commandQueue.push(...(commands || []));
  console.log("Received commands:", commands);
  res.json({ ok: true, queued: commands?.length || 0 });
});

// 手机中继轮询取指令（每300ms）
app.get("/toy-next", (req, res) => {
  const { secret } = req.query;
  if (secret !== SECRET) {
    return res.status(403).json({ error: "invalid secret" });
  }
  const cmds = commandQueue.splice(0, commandQueue.length);
  res.json({ commands: cmds });
});

// MCP SSE 端点
app.get("/mcp", (req, res) => {
  const { secret } = req.query;
  if (secret !== SECRET) {
    return res.status(403).send("invalid secret");
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // 初始化
  res.write(`data: ${JSON.stringify({
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "0.1.0",
      capabilities: { tools: {} },
      serverInfo: { name: "svakom-ble", version: "1.0.0" }
    }
  })}\n\n`);

  // 工具列表
  const tools = [
    {
      name: "toy_set_speed",
      description: "Set toy intensity 0-100%",
      inputSchema: {
        type: "object",
        properties: { speed: { type: "number", description: "Intensity 0.0-1.0" } },
        required: ["speed"]
      }
    },
    {
      name: "toy_set_pattern",
      description: "Set vibration pattern 1-8",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "number", description: "Pattern 1-8" },
          level: { type: "number", description: "Level 0.0-1.0" }
        },
        required: ["pattern"]
      }
    },
    {
      name: "toy_stop",
      description: "Stop immediately",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "toy_status",
      description: "Check relay status",
      inputSchema: { type: "object", properties: {} }
    }
  ];

  res.write(`data: ${JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/list",
    params: { tools }
  })}\n\n`);

  // 处理工具调用
  req.on("data", (chunk) => {
    try {
      const msg = JSON.parse(chunk.toString());
      if (msg.method === "tools/call") {
        const { name, arguments: args } = msg.params;
        let cmd = null;

        if (name === "toy_set_speed") {
          const speed = Math.round((args.speed || 0.5) * 255);
          cmd = { type: "speed", value: speed };
        } else if (name === "toy_set_pattern") {
          cmd = {
            type: "pattern",
            mode: args.pattern || 1,
            level: Math.round((args.level || 0.5) * 5)
          };
        } else if (name === "toy_stop") {
          cmd = { type: "stop" };
        } else if (name === "toy_status") {
          res.write(`data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [{ type: "text", text: "Online | Queue: " + commandQueue.length }]
            }
          })}\n\n`);
          return;
        }

        if (cmd) {
          commandQueue.push(cmd);
          res.write(`data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [{ type: "text", text: "OK: " + JSON.stringify(cmd) }]
            }
          })}\n\n`);
        }
      }
    } catch (e) {
      console.error("MCP parse error:", e);
    }
  });
});

// 启动
app.listen(PORT, () => {
  console.log("svakom-bridge running on port " + PORT);
});
