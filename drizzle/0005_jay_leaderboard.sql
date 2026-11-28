CREATE TABLE `jay_best` (
	`owner` text PRIMARY KEY NOT NULL,
	`score` integer NOT NULL,
	`hits` integer NOT NULL,
	`achieved` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jay_scores_sorted` ON `jay_best` (`score`,`hits`,`achieved`);