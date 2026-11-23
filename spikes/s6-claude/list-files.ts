// Lists the files left in the workspace; the spike must leave none of its own (square.png, note.pdf).
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
const files = [];
for await (const f of client.files.list()) files.push({ id: f.id, filename: f.filename, created_at: f.created_at });
console.log(JSON.stringify({ count: files.length, files }, null, 1));
