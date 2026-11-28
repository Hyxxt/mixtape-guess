CREATE TABLE `points_best` (
	`owner` text PRIMARY KEY NOT NULL,
	`score` integer NOT NULL,
	`hits` integer NOT NULL,
	`achieved` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `points_scores_sorted` ON `points_best` (`score`,`hits`,`achieved`);--> statement-breakpoint
ALTER TABLE `games` ADD `scoring_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS visits(id TEXT PRIMARY KEY, at INTEGER NOT NULL, did TEXT NOT NULL, path TEXT NOT NULL, fresh INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
