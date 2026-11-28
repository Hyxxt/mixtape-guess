import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const players = sqliteTable("players", {
  id: text("id").primaryKey(), nickname: text("nickname").notNull(), created:integer("created").notNull()
});
export const games = sqliteTable("games", {
  id: text("id").primaryKey(), owner: text("owner").notNull().references(()=>players.id),
  questions: text("questions").notNull(), cursor:integer("cursor").notNull(), version:integer("version").notNull(),
  score:integer("score").notNull(), hits:integer("hits").notNull(), updated:integer("updated").notNull(),
  finished:integer("finished").notNull(), scoringVersion:integer("scoring_version").notNull().default(1),
  mode:text("mode").notNull().default("ranked")
}, t=>[uniqueIndex("one_active_round_per_mode").on(t.owner,t.mode).where(sql`${t.finished}=0`),index("stale_rounds").on(t.updated)]);
export const best = sqliteTable("best", {
  owner:text("owner").primaryKey().references(()=>players.id),score:integer("score").notNull(),
  hits:integer("hits").notNull(), achieved:integer("achieved").notNull()
}, t=>[index("scores_sorted").on(t.score,t.hits,t.achieved)]);
export const pointsBest = sqliteTable("points_best", {
  owner:text("owner").primaryKey().references(()=>players.id),score:integer("score").notNull(),
  hits:integer("hits").notNull(), achieved:integer("achieved").notNull()
}, t=>[index("points_scores_sorted").on(t.score,t.hits,t.achieved)]);
export const hotBest = sqliteTable("hot_best", {
  owner:text("owner").primaryKey().references(()=>players.id), score:integer("score").notNull(),
  hits:integer("hits").notNull(), achieved:integer("achieved").notNull()
}, t=>[index("hot_scores_sorted").on(t.score,t.hits,t.achieved)]);
