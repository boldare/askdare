// Deletes every vector store and file the spike recorded in .created.json: `pnpm cleanup`.
import { client, deleteEverything, readLedger } from './openai.ts';

await deleteEverything(client(), (line) => console.log(line));
const left = await readLedger();
console.log(`left: ${left.vectorStores.length} vector stores, ${left.files.length} files`);
