-- Record the reported score on the all-time points leaderboard.
INSERT INTO best(owner,score,hits,achieved)
SELECT id,92,10,unixepoch()*1000 FROM players WHERE id='hot-reported-huangxx'
ON CONFLICT(owner) DO UPDATE SET score=excluded.score,hits=excluded.hits,achieved=excluded.achieved
WHERE excluded.score>best.score OR (excluded.score=best.score AND excluded.hits>best.hits);
