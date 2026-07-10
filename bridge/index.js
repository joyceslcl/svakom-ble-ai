import express from "express";

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "default_secret";
const PORT = process.env.PORT || 3000;

let commandQueue = [];

// ========== ST462A 工具定义 ==========
const TOOLS = [
  {
    name: "toy_set_speed",
    description: "震动强度 0.0-1.0（0%到100%）",
    inputSchema: {
      type: "object",
      properties: { speed: { type: "number", description: "强度 0.0-1.0" } },
      required: ["speed"]
    }
  },
  {
    name: "toy_constrict",
    description: "吮吸档位 1-3",
    inputSchema: {
      type: "object",
      properties: { level: { type: "number", description: "档位 1-3" } },
      required: ["level"]
    }
  },
  {
    name: "toy_rotate",
    description: "旋转速度 0.0-1.0（0%到100%）",
    inputSchema: {
      type: "object",
      properties: { speed: { type: "number", description: "速度 0.0-1.0" } },
      required: ["speed"]
    }
  },
  {
    name: "toy_stop",
    description: "立即停止所有功能",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "toy_status",
    description: "查看中继状态和队列",
    inputSchema: { type: "object", properties: {} }
  }
];

// ========== ST462A 工具执行 ==========
function handleToolCall(name, args) {
  if (name === "toy_set_speed") {
    commandQueue.push({ type: "speed", value: args.speed || 0.5 });
    return `✅ 震动已设为 ${Math.round((args.speed || 0.5) * 100)}%`;
  } else if (name === "toy_constrict") {
    commandQueue.push({ type: "constrict", level: args.level || 1 });
    return `✅ 吮吸已设为第 ${args.level || 1} 档`;
  } else if (name === "toy_rotate") {
    commandQueue.push({ type: "rotate", value: args.speed || 0.5 });
    return `✅ 旋转已设为 ${Math.round((args.speed || 0.5) * 100)}%`;
  } else if (name === "toy_stop") {
    commandQueue.push({ type: "stop" });
    return "✅ 已停止所有功能";
  } else if (name === "toy_status") {
    return `🟢 在线 | 队列: ${commandQueue.length} 条 | 型号: ST462A (Klitty)`;
  }
  return "❌ 未知工具";
}

// ========== POST /mcp（聊天前端专用） ==========
app.post("/mcp", (req, res) => {
  const { secret } = req.query;
  if (secret !== SECRET) {
    return res.status(403).json({ error: "invalid secret" });
  }

  const { method, params, id } = req.body || {};

  if (method === "initialize") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "0.1.0",
        capabilities: { tools: {} },
        serverInfo: { name: "svakom-ble-st462a", version: "1.0.0" }
      }
    });
  }

  if (method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: { tools: TOOLS }
    });
  }

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

  return res.status(400).json({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unknown method: ${method}` }
  });
});

// ========== GET /mcp（SSE 备用） ==========
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
      serverInfo: { name: "svakom-ble-st462a", version: "1.0.0" }
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
  console.log("svakom-bridge (ST462A) running on port " + PORT);
});
