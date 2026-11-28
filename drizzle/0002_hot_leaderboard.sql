CREATE TABLE `hot_best` (
	`owner` text PRIMARY KEY NOT NULL,
	`score` integer NOT NULL,
	`hits` integer NOT NULL,
	`achieved` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hot_scores_sorted` ON `hot_best` (`score`,`hits`,`achieved`);--> statement-breakpoint
DROP INDEX `one_active_round`;--> statement-breakpoint
ALTER TABLE `games` ADD `mode` text DEFAULT 'ranked' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_round_per_mode` ON `games` (`owner`,`mode`) WHERE "games"."finished"=0;
--> statement-breakpoint
-- Player-reported result earned before hot rounds were stored on the server.
INSERT INTO players(id,nickname,created) VALUES('hot-reported-huangxx','黄xx',unixepoch()*1000);
--> statement-breakpoint
INSERT INTO hot_best(owner,score,hits,achieved)
SELECT id,100,10,created FROM players WHERE id='hot-reported-huangxx';
