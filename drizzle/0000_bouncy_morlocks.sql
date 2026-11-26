CREATE TABLE `best` (
	`owner` text PRIMARY KEY NOT NULL,
	`score` integer NOT NULL,
	`hits` integer NOT NULL,
	`achieved` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scores_sorted` ON `best` (`score`,`hits`,`achieved`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`questions` text NOT NULL,
	`cursor` integer NOT NULL,
	`version` integer NOT NULL,
	`score` integer NOT NULL,
	`hits` integer NOT NULL,
	`updated` integer NOT NULL,
	`finished` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_round` ON `games` (`owner`) WHERE "games"."finished"=0;--> statement-breakpoint
CREATE INDEX `stale_rounds` ON `games` (`updated`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL,
	`created` integer NOT NULL
);
