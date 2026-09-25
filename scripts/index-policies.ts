import { indexPolicies } from "../src/lib/assistant/rag.ts";
import { shutdownTraces } from "../src/lib/assistant/tracing.ts";
import { pool } from "../src/lib/db.ts";
try {for(const variant of ["sections","fixed"] as const)console.log(await indexPolicies(variant));}
catch{console.error("Policy indexing failed. Check AI keys, pgvector and the generated demo PDF. No credentials or source data printed.");process.exitCode=1;}
finally{await shutdownTraces();await pool().end();}
