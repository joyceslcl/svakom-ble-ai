import express from "express";

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "default_secret";
const PORT = process.env.PORT || 3000;

let commandQueue = [];

// ========== MCP 工具定义 ==========
const TOOLS = [
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

// ========== 处理 MCP 工具调用 ==========
function handleToolCall(name, args) {
  if (name === "toy_set_speed") {
    const speed = Math.round((args.speed || 0.5) * 255);
    commandQueue.push({ type: "speed", value: speed });
    return `✅ Speed set to ${Math.round((args.speed || 0.5) * 100)}%`;
  } else if (name === "toy_set_pattern") {
    const mode = args.pattern || 1;
    const level = Math.round((args.level || 0.5) * 5);
    commandQueue.push({ type: "pattern", mode, level });
    return `✅ Pattern ${mode} at level ${level}`;
  } else if (name === "toy_stop") {
    commandQueue.push({ type: "stop" });
    return "✅ Stopped";
  } else if (name === "toy_status") {
    return `🟢 Online | Queue: ${commandQueue.length}`;
  }
  return "❌ Unknown tool";
}

// ========== POST /mcp（HTTP JSON-RPC 模式，你的聊天前端用的） ==========
app.post("/mcp", (req, res) => {
  const { secret } = req.query;
  if (secret !== SECRET) {
    return res.status(403).json({ error: "invalid secret" });
  }

  const { method, params, id } = req.body || {};

  // initialize
  if (method === "initialize") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "0.1.0",
        capabilities: { tools: {} },
        serverInfo: { name: "svakom-ble", version: "1.0.0" }
      }
    });
  }

  // tools/list
  if (method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: { tools: TOOLS }
    });
  }

  // tools/call
  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    const text = handleToolCall(name, args || {});
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text }]
      }
    });
  }

  // 未知方法
  return res.status(400).json({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unknown method: ${method}` }
  });
});

// ========== GET /mcp（SSE 模式，备用） ==========
app.get("/mcp", (req, res) => {
  const { secret } = req.query;
  if (secret !== SECRET) {
    return res.status(403).send("invalid secret");
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.write(`data: ${JSON.stringify({
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "0.1.0",
      capabilities: { tools: {} },
      serverInfo: { name: "svakom-ble", version: "1.0.0" }
    }
  })}\n\n`);

  res.write(`data: ${JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/list",
    params: { tools: TOOLS }
  })}\n\n`);

  req.on("data", (chunk) => {
    try {
      const msg = JSON.parse(chunk.toString());
      if (msg.method === "tools/call") {
        const { name, arguments: args } = msg.params || {};
        const text = handleToolCall(name, args || {});
        res.write(`data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text }] }
        })}\n\n`);
      }
    } catch (e) {
      console.error("MCP parse error:", e);
    }
  });
});

// ========== 玩具中继 API ==========
app.post("/toy-next", (req, res) => {
  const { secret, commands } = req.body;
  if (secret !== SECRET) {
    return res.status(403).json({ error: "invalid secret" });
  }
  commandQueue.push(...(commands || []));
  console.log("Received commands:", commands);
  res.json({ ok: true, queued: commands?.length || 0 });
});

app.get("/toy-next", (req, res) => {
  const { secret } = req.query;
  if (secret !== SECRET) {
    return res.status(403).json({ error: "invalid secret" });
  }
  const cmds = commandQueue.splice(0, commandQueue.length);
  res.json({ commands: cmds });
});

// ========== 启动 ==========
app.listen(PORT, () => {
  console.log("svakom-bridge running on port " + PORT);
});
