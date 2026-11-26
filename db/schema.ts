import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const players = sqliteTable("players", {
  id: text("id").primaryKey(), nickname: text("nickname").notNull(), created:integer("created").notNull()
});
export const games = sqliteTable("games", {
  id: text("id").primaryKey(), owner: text("owner").notNull().references(()=>players.id),
  questions: text("questions").notNull(), cursor:integer("cursor").notNull(), version:integer("version").notNull(),
  score:integer("score").notNull(), hits:integer("hits").notNull(), updated:integer("updated").notNull(),
  finished:integer("finished").notNull()
}, t=>[uniqueIndex("one_active_round").on(t.owner).where(sql`${t.finished}=0`),index("stale_rounds").on(t.updated)]);
export const best = sqliteTable("best", {
  owner:text("owner").primaryKey().references(()=>players.id),score:integer("score").notNull(),
  hits:integer("hits").notNull(), achieved:integer("achieved").notNull()
}, t=>[index("scores_sorted").on(t.score,t.hits,t.achieved)]);
