// Probe the SSE endpoint and decode each frame so we can see exactly which
// trace events (and which kinds) are arriving over the wire.
const url = "http://localhost:3000/api/research/candidate/stream";
const fd = new FormData();
fd.append("postLinks", JSON.stringify(["https://x.com/easya_app/status/1914287335002210623"]));

const t0 = Date.now();
const res = await fetch(url, { method: "POST", body: fd });
console.log(`headers @ ${Date.now() - t0}ms ce=${res.headers.get("content-encoding")} te=${res.headers.get("transfer-encoding")}`);

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

function parseFrame(raw) {
  const lines = raw.split(/\r?\n/);
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  return dataLines.length ? { event, data: dataLines.join("\n") } : null;
}

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const raw = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    const f = parseFrame(raw);
    if (!f) continue;
    const t = (Date.now() - t0).toString().padStart(6);
    if (f.event === "trace") {
      try {
        const ev = JSON.parse(f.data);
        console.log(`+${t}ms  trace  agent=${ev.agent.padEnd(34)} kind=${(ev.kind||"-").padEnd(12)} msg=${(ev.message||"").slice(0,60)}`);
      } catch {
        console.log(`+${t}ms  trace  (parse fail) ${f.data.slice(0,100)}`);
      }
    } else {
      console.log(`+${t}ms  ${f.event}  ${f.data.slice(0, 80)}`);
    }
  }
}
console.log(`closed @ ${Date.now() - t0}ms`);
