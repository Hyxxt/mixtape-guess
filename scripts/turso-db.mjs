import {readdirSync,readFileSync} from "node:fs";

// Minimal D1-style wrapper around Turso/libSQL. server/api.mjs only needs
// prepare/bind/first/all/run/batch, so keeping the adapter small avoids
// touching the query code when the demo moves off the local SQLite file.
export async function tursoDb({url, authToken}) {
  // Loaded on demand so a deployment without the optional Turso package can
  // still start with the local SQLite fallback.
  const {createClient}=await import("@libsql/client");
  const client=createClient({url,authToken});
  try {
    const [,migrations]=await client.batch([
      "CREATE TABLE IF NOT EXISTS _app_migrations(name TEXT PRIMARY KEY)",
      "SELECT name FROM _app_migrations"
    ],"write");
    const applied=new Set(migrations.rows.map(row=>row.name));
    const folder=new URL("../drizzle/",import.meta.url);
    for(const name of readdirSync(folder).filter(n=>n.endsWith(".sql")).sort()){
      if(applied.has(name)) continue;
      const statements=readFileSync(new URL(name,folder),"utf8")
        .split("--> statement-breakpoint").map(sql=>sql.trim()).filter(Boolean);
      await client.batch([
        ...statements.map(sql=>({sql,args:[]})),
        {sql:"INSERT INTO _app_migrations(name) VALUES(?)",args:[name]}
      ],"write");
    }
  } catch (error) {
    client.close();
    throw error;
  }
  function statement(sql,args=[]){
    const query={sql,args};
    return {
      query,
      bind:(...values)=>statement(sql,values),
      first:async()=>(await client.execute(query)).rows[0]||null,
      all:async()=>({results:(await client.execute(query)).rows}),
      run:async()=>({meta:{changes:(await client.execute(query)).rowsAffected||0}})
    };
  }
  return {
    prepare:statement,
    async batch(queries){
      const results=await client.batch(queries.map(q=>q.query),"write");
      return results.map(result=>({meta:{changes:result.rowsAffected||0}}));
    },
    close:()=>client.close()
  };
}
