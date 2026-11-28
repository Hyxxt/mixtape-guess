CREATE TABLE `weekly_best` (
	`week_start` integer NOT NULL,
	`owner` text NOT NULL,
	`score` integer NOT NULL,
	`hits` integer NOT NULL,
	`achieved` integer NOT NULL,
	PRIMARY KEY(`week_start`, `owner`),
	FOREIGN KEY (`owner`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `weekly_scores_sorted` ON `weekly_best` (`week_start`,`score`,`hits`,`achieved`);--> statement-breakpoint
CREATE INDEX `recent_rounds_by_player` ON `games` (`owner`,`mode`,`updated`,`id`);