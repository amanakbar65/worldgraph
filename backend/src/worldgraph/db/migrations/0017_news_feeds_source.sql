-- Settings → Data sources lists every row of `source`. The business news
-- feeds (pipeline/sources/rss.py: BBC, Guardian, ECB, RBI, …) had no row, so
-- the central attribution list left out 22 publishers. Each story still names
-- and links its own outlets under "Reported by".

insert into source (id, name, homepage, licence, attribution) values
    ('news-feeds', 'Business news feeds', null,
     'Headlines and links only, under each publisher''s feed terms',
     'Headlines and links from publishers and official bodies; each story names and links its outlet')
on conflict (id) do nothing;
