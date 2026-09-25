-- =============================================================
-- VALLÉ Advenature™ Park: seed data
-- GENERATED FILE. Do not edit by hand.
-- Regenerate with:  node scripts/generate-seed.js
-- Source of truth:  seed/data.json
-- Load after schema.sql. Re-runnable (truncates content tables).
-- =============================================================

SET client_encoding = 'UTF8';

BEGIN;

TRUNCATE TABLE
  gallery_shots, experience_galleries, experience_facts, map_pins, menu_items, menu_groups, restaurant_gallery, restaurants, package_tier_items, package_tiers, package_addons, vip_items, combo_items, combos, cinematic_items, price_list, photo_tiers, photo_addons, team_pack_items, team_packs, hero_slides, experiences, categories, settings, job_applications, job_vacancies, staff_users
RESTART IDENTITY CASCADE;

-- categories
INSERT INTO categories (id, name, badge, color, fg, pulse) VALUES
  ('adventure', 'Adventure', 'ADVENTURE', '#FF3358', '#FFFFFF', '#FF3358'),
  ('nature', 'Nature', 'NATURE', '#33FF74', '#340057', '#12B54A'),
  ('kids', 'Kids Park', 'KIDS PARK', '#FFFC33', '#340057', '#B09A00'),
  ('tours', 'Tours & Groups', 'TOUR', '#7333FF', '#FFFFFF', '#7333FF');

-- experiences
INSERT INTO experiences (id, name, category_id, thrill, duration_label, age_label, base_price, price_mode, flat_label, image, blurb, detail, price_rr, price_nr, sort_order) VALUES
  ('zipline', 'Zipline Adventures', 'adventure', 5, '1–3 H', '8+', 1600, 'pp', NULL, '/images/zipline-waterfall.webp', 'Fly without wings: high-speed flights over valleys, rivers and forest canopy, with 8 routes from a 300 m waterfall hop to a 5.5 km epic.', NULL, 875, 1375, 0),
  ('bicycle', 'Bicycle Zipline', 'adventure', 5, '15 MIN', '10+', 1200, 'pp', NULL, '/images/bicycle-joy.webp', '400 metres of sky-high pedalling on a suspended cable, 18 metres above the valley floor.', NULL, 700, 1150, 1),
  ('nepalese', 'Nepalese Bridge', 'adventure', 4, '45 MIN', '10+', 900, 'pp', NULL, '/images/bridge-family.webp', 'Cross 350 metres of breathtaking heights, suspended 80–100 metres above the ground.', NULL, 700, 1300, 2),
  ('quad', 'Quad', 'adventure', 4, '1–2 H', '16+ DRIVE', 2500, 'pp', NULL, '/images/quad-river.webp', 'Hold on tight: guided off-road thrills across Vallé’s wildest trails, mud and all.', NULL, 2800, 3600, 3),
  ('buggy', 'Buggy', 'adventure', 3, '1–2 H', '16+ DRIVE', 3200, 'flat', '/ buggy', '/images/buggy-river.webp', 'Experience Vallé’s raw beauty in comfort: a 2+1 seater buggy on the same wild trails.', NULL, 6200, 7500, 4),
  ('luge', 'Mountain Luge Kart', 'adventure', 3, '20 MIN', '6+', 800, 'pp', NULL, '/images/luge-duo-curve.webp', 'Fast, exhilarating and gravity-powered. Hold tight and ride the wild curves downhill.', NULL, 500, 700, 5),
  ('peak', 'The Peak', 'adventure', 2, '2 H', 'ALL AGES', 1500, 'pp', NULL, '/images/peak-tower.webp', 'Ascend to the highest point of the southern mountains, where unmatched views await.', NULL, 3850, 4900, 6),
  ('private', 'Private Expedition', 'tours', 2, '3 H', 'ALL AGES', 5500, 'flat', '/ group', '/images/expedition-raptor-ocean.webp', 'An exclusive off-road tour revealing Mauritius’ pristine beauty: your group, your pace.', NULL, 3350, 3800, 7),
  ('group', 'Group Expedition', 'tours', 2, '3 H', 'ALL AGES', 2800, 'pp', NULL, '/images/expedition-convoy-river.webp', 'A personalised group tour unveiling the natural splendour of the island’s south.', NULL, 1100, 1350, 8),
  ('waterfalls', 'Waterfalls', 'nature', 1, 'SELF-GUIDED', 'ALL AGES', 0, 'entry', NULL, '/images/waterfalls.avif', 'The breathtaking cascades of the valley: a serene, magical counterpoint to the thrills.', NULL, NULL, NULL, 9),
  ('coloured', '23 Coloured Earth', 'nature', 1, 'SELF-GUIDED', 'ALL AGES', 0, 'entry', NULL, '/images/23colouredearth.avif', 'Feel the colours: 23 hues of volcanic alchemy in one geological wonder, unique to Chamouny.', NULL, NULL, NULL, 10),
  ('animals', 'Animals', 'nature', 1, 'SELF-GUIDED', 'ALL AGES', 0, 'entry', NULL, '/images/animalpark.avif', 'Meet the wildest locals: giant tortoises, deer and the wild at heart, in open shared habitats.', NULL, NULL, NULL, 11),
  ('trees', 'Endemic Trees', 'nature', 1, 'SELF-GUIDED', 'ALL AGES', 0, 'entry', NULL, '/images/endemictrees.avif', 'Take it slow among centuries-old ebony and bois de natte, rooted in the soul of the island.', NULL, NULL, NULL, 12),
  ('rock', 'Rock Garden', 'nature', 1, 'SELF-GUIDED', 'ALL AGES', 0, 'entry', NULL, '/images/rockgarden.avif', 'Find stillness in the wild: a zen-inspired Japanese garden hidden in the valley.', NULL, NULL, NULL, 13),
  ('pirate', 'Pirate Ship', 'kids', 1, '15 MIN', '3–12', 200, 'pp', NULL, '/images/pirateship.avif', 'Set sail on gentle thrills: pirate adventures for the smallest buccaneers.', NULL, 200, 300, 14),
  ('bonding', 'Bonding Roller Coaster Zipline', 'kids', 2, '15 MIN', '4+ W/ ADULT', 200, 'pp', NULL, '/images/bondingrollercoasterzipline.avif', 'A ride that bonds parents and children: gentle thrills, curves and giggles.', NULL, 200, 300, 15),
  ('coaster', 'Roller Coaster Express', 'kids', 2, '10 MIN', '4–12', 200, 'pp', NULL, '/images/rollercoast.avif', 'Twists, turns and laughter aboard the Kids Park’s favourite express.', NULL, 200, 300, 16),
  ('playground', 'Outdoor Playground', 'kids', 1, 'OPEN PLAY', '3–12', 0, 'entry', NULL, '/images/outdoorplayground.avif', 'Climb, slide and explore in an imaginative outdoor adventure space.', NULL, NULL, NULL, 17),
  ('miniquad', 'Mini Quad', 'kids', 2, '15 MIN', '6–12', 200, 'pp', NULL, '/images/miniquad.avif', 'Young adventurers steer their own quad on a safe, supervised track.', NULL, 200, 300, 18),
  ('miniexc', 'Mini Excavator', 'kids', 1, '15 MIN', '4–12', 200, 'pp', NULL, '/images/miniexcavator.avif', 'Kids dig, scoop and build with their own mini excavator, hands-on play that quietly builds motor skills.', 'Dig, build and play: creative construction fun at kid scale.', 200, 300, 19),
  ('kaz', 'Kaz Bon Bon', 'kids', 1, 'ANYTIME', 'ALL AGES', 0, 'kiosk', NULL, '/images/kazbonbon.avif', 'A delightful stop where kids pick from a wall of sweets and refreshing slushies, a tasty twist to an adventure-filled day.', 'A delightful sweets stop: tasty treats to fuel an advenature-filled day.', NULL, NULL, 20);

-- experience_facts
INSERT INTO experience_facts (experience_id, text, sort_order) VALUES
  ('zipline', '8 routes: The Plunge (500 m) up to the Advenature Flight (5.5 km, 11 lines)', 0),
  ('zipline', 'The Waterfall Zipline flies you to the Chamouzé falls and back', 1),
  ('zipline', 'Full harness, briefing and guides included', 2),
  ('zipline', 'Closed shoes required · weather dependent', 3),
  ('bicycle', '400 m line at 18 m above ground, about 15 minutes', 0),
  ('bicycle', 'Ride a suspended bike, harnessed at all times', 1),
  ('bicycle', 'One of only a handful in the world', 2),
  ('nepalese', '350 m crossing, 80–100 m above the valley floor', 0),
  ('nepalese', 'Full harness and safety briefing included', 1),
  ('nepalese', 'Pairs perfectly with the ziplines for a high-wire day', 2),
  ('quad', 'Guided convoy across off-road valley trails', 0),
  ('quad', 'Driving licence required · passengers welcome', 1),
  ('quad', 'Mud is part of the fun, dress accordingly', 2),
  ('buggy', '2+1 seater, bring the family along', 0),
  ('buggy', 'Same trails as the quads, more comfort', 1),
  ('buggy', 'Driving licence required', 2),
  ('luge', 'Gravity-powered karts on a mountain track', 0),
  ('luge', 'A great first thrill for younger adventurers', 1),
  ('luge', 'Helmets provided', 2),
  ('peak', 'Highest viewpoint of the southern range', 0),
  ('peak', 'Guided ascent with photo stops', 1),
  ('peak', 'Bring water and sun protection', 2),
  ('private', 'Private guide and vehicle for your group', 0),
  ('private', 'Tailored route across the park’s highlights', 1),
  ('private', 'Ideal for families and small groups', 2),
  ('group', 'Personalised tour of the park’s natural splendour', 0),
  ('group', 'Great value for larger parties, ideal for team building', 1),
  ('group', 'Advance booking recommended', 2),
  ('waterfalls', 'Several falls across the valley, incl. the Chamouzé cascade', 0),
  ('waterfalls', 'Viewpoints all along the walking trail', 1),
  ('waterfalls', 'Included with park entry', 2),
  ('coloured', '23 hues of volcanic earth in a single dune', 0),
  ('coloured', 'A geological phenomenon unique to this valley', 1),
  ('coloured', 'Included with park entry', 2),
  ('animals', 'Giant tortoises, deer and more in open habitats', 0),
  ('animals', 'Feeding times posted at the entrance', 1),
  ('animals', 'Included with park entry', 2),
  ('trees', 'Centuries-old ebony and bois de natte trees', 0),
  ('trees', 'A shaded, easy walking trail', 1),
  ('trees', 'Included with park entry', 2),
  ('rock', 'Zen-inspired Japanese rock garden', 0),
  ('rock', 'A quiet pause between adventures', 1),
  ('rock', 'Included with park entry', 2),
  ('pirate', 'Gentle swings suited to young kids', 0),
  ('pirate', 'Adult supervision required', 1),
  ('pirate', 'In the Kids Park zone, near the entrance', 2),
  ('bonding', 'Parent and child ride together', 0),
  ('bonding', 'Gentle curves designed for first thrills', 1),
  ('bonding', 'In the Kids Park zone', 2),
  ('coaster', 'The Kids Park favourite', 0),
  ('coaster', 'Height requirements apply', 1),
  ('coaster', 'Adult supervision required', 2),
  ('playground', 'Open play, come and go all day', 0),
  ('playground', 'Shaded seating for parents', 1),
  ('playground', 'Adult supervision required', 2),
  ('miniquad', 'Safe, fenced mini track', 0),
  ('miniquad', 'Helmets and briefing included', 1),
  ('miniquad', 'In the Kids Park zone', 2),
  ('miniexc', 'Real digging, kid-sized machines', 0),
  ('miniexc', 'Supervised sessions', 1),
  ('miniexc', 'In the Kids Park zone', 2),
  ('kaz', 'Sweets and treats kiosk in the Kids Park', 0),
  ('kaz', 'Pay at the kiosk', 1);

-- experience_galleries
INSERT INTO experience_galleries (experience_id, eyebrow, t1, t2, copy, foot, cta) VALUES
  ('group', 'THE OPEN-SIDED 4X4 · 8 SEATS · GUIDE ON BOARD', 'Ride where', 'no path goes', 'One truck, your group, and the wild south of Mauritius: river crossings, deer meadows, waterfalls and a private lookout deck. Three hours that most visitors never see.', 'MINIMUM 5 GUESTS · 3 HOURS · ALL AGES', 'Book the expedition →'),
  ('peak', '602 METRES UP · THE HIGHEST POINT OF THE SOUTH · ALL AGES', 'The whole south', 'in one look', 'Ride up past La Tour to the summit, where the valley drops away and the lagoon line runs from Bel Ombre to Souillac. Benches, a lookout tower, and the best photo of your trip.', 'ABOUT 2 HOURS · GUIDED ASCENT · BRING WATER AND SUN PROTECTION', 'Add The Peak to my day →'),
  ('buggy', 'UP TO 3 SEATS · SEATBELTS AND ROLL CAGE · KIDS RIDE ALONG', 'The whole family,', 'one buggy', 'A side-by-side with a roof, belts and room for three. The same rivers and forest tracks as the quad, except everyone rides together and nobody gets left at the gate.', 'FROM RS 3,200 PER BUGGY · DRIVER 16+ WITH LICENCE · HELMETS PROVIDED', 'Add the buggy to my day →'),
  ('quad', 'STANDARD 450CC OR EXCLUSIVE 625CC · DRIVER 16+ · PASSENGER WELCOME', 'Mud, rivers,', 'no traffic', 'One hour on the Discovery track or two on the Advenature Tour, guided the whole way. River crossings, forest single track and a ridge above the Coloured Earth with the ocean behind it.', 'FROM RS 2,800 · DRIVING LICENCE REQUIRED · HELMETS PROVIDED', 'Add the quad to my day →'),
  ('zipline', '8 ROUTES · 500 M TO 5.5 KM · AGE 8 AND UP', 'Fly the whole', 'valley, line by line', 'From a single 500 m hop to eleven lines strung across 5.5 kilometres of forest, river and waterfall. Pick your route, clip in, and let the valley do the rest.', 'FULL HARNESS · GUIDES ON EVERY PLATFORM · CLOSED SHOES REQUIRED', 'Choose my zipline route →'),
  ('nepalese', '350 METRES LONG · 80 TO 100 M ABOVE THE VALLEY · AGE 10+', 'Walk out', 'over nothing', 'One plank at a time, harnessed to the line above, with a hundred metres of open valley under your feet. Slow enough for the whole family, high enough that nobody forgets it.', 'ABOUT 45 MINUTES · FULL HARNESS · BRIEFING INCLUDED', 'Add the bridge to my day →'),
  ('bicycle', '400 METRES OF CABLE · 18 M ABOVE THE VALLEY · AGE 10+', 'Pedal', 'across the sky', 'A bicycle bolted to a cable, banana trees below and nothing but air under the wheels. One of only a handful in the world, and easy enough that anyone who can ride a bike can do it.', 'ABOUT 15 MINUTES · HARNESSED AT ALL TIMES · RIDE SIDE BY SIDE', 'Add the bicycle zipline →'),
  ('luge', 'GRAVITY POWERED · 6 YEARS AND UP · HELMETS PROVIDED', 'Steer it,', 'brake it, race it', 'No engine, no pedals. You control the speed the whole way down a winding mountain track, past the caution chevrons and into the last banked curve. One ride is never enough.', 'FROM RS 500 · 1, 2 OR 3 RIDES · ADULTS AND KIDS FROM 6', 'Add the luge to my day →'),
  ('private', 'YOUR OWN 4X4 RAPTOR · UP TO 4 GUESTS · PRIVATE GUIDE', 'Your route,', 'your pace', 'Just your party and a guide who knows every track. Stop where you want, stay as long as you like, from the 23 Coloured Earth to the ridge where the ocean fills the horizon.', 'FROM 2 TO 4 GUESTS · 3 HOURS · PRIVATE GUIDE INCLUDED', 'Book the private expedition →');

-- gallery_shots
INSERT INTO gallery_shots (experience_id, src, tag, cap, pos, sort_order) VALUES
  ('group', '/images/expedition-convoy-river.webp', 'RIVER CROSSING', 'Straight through the stream, feet dry, cameras up.', NULL, 0),
  ('group', '/images/expedition-convoy-meadow.webp', 'OPEN MEADOWS', 'Rolling green, deer country, no other vehicle in sight.', NULL, 1),
  ('group', '/images/expedition-convoy-lookout.webp', 'PRIVATE LOOKOUT', 'A deck built for your group, and the whole southern valley below.', NULL, 2),
  ('group', '/images/expedition-convoy-trail.webp', 'FOREST TRACK', 'Twelve kilometres of trail no walking path reaches.', NULL, 3),
  ('peak', '/images/peak-view.webp', 'THE VIEW', 'Green valley, cane fields, then the reef breaking white.', '50% 62%', 0),
  ('peak', '/images/peak-tower.webp', 'THE LOOKOUT TOWER', 'Climb the timber deck and see the coast end to end.', NULL, 1),
  ('peak', '/images/peak-bench.webp', 'TAKE A MINUTE', 'Benches at the edge, built for exactly this.', NULL, 2),
  ('peak', '/images/peak-arrival.webp', 'THE LAST STRETCH', 'The final walk to the summit platform.', NULL, 3),
  ('buggy', '/images/buggy-river.webp', 'INTO THE RIVER', 'Wheels in the water, everyone screaming, nobody soaked.', NULL, 0),
  ('buggy', '/images/buggy-faces.webp', 'THREE ACROSS', 'Belted in side by side, ocean behind you.', NULL, 1),
  ('buggy', '/images/buggy-forest.webp', 'FOREST TRACK', 'Rock, root and mud through the deep green.', NULL, 2),
  ('buggy', '/images/buggy-earth.webp', 'PAST THE 23 EARTHS', 'The coloured dunes right beside the track.', NULL, 3),
  ('quad', '/images/quad-earth.webp', 'THE OCEAN RIDGE', 'Past the Coloured Earth with the southern sea in the distance.', NULL, 0),
  ('quad', '/images/quad-river.webp', 'THROUGH THE RIVER', 'Yes, you go straight through it. Yes, you will get wet.', NULL, 1),
  ('quad', '/images/quad-duo.webp', 'RIDE TWO UP', 'One drives, one holds on and does the screaming.', NULL, 2),
  ('quad', '/images/quad-convoy.webp', 'GUIDED CONVOY', 'A guide in front, a buggy behind, jungle either side.', NULL, 3),
  ('zipline', '/images/zipline-waterfall.webp', 'WATERFALL LINE', 'Straight past the Chamouzé falls, close enough to feel the spray.', NULL, 0),
  ('zipline', '/images/zipline-superman.webp', 'ARMS OUT', 'Nothing under you but green, all the way down the valley.', NULL, 1),
  ('zipline', '/images/zipline-duo.webp', 'TWO AT A TIME', 'Parallel lines, so you fly together and race to the platform.', NULL, 2),
  ('zipline', '/images/zipline-tandem.webp', 'TANDEM WITH A GUIDE', 'Younger flyers ride harnessed to a guide from 8 years up.', NULL, 3),
  ('nepalese', '/images/bridge-span.webp', 'THE CROSSING', 'A single timber walkway strung across the whole valley.', NULL, 0),
  ('nepalese', '/images/bridge-couple.webp', 'FIRST STEPS', 'Hands on the cable, eyes anywhere but down.', NULL, 1),
  ('nepalese', '/images/bridge-laugh.webp', 'HALFWAY', 'The moment the nerves turn into laughing.', NULL, 2),
  ('nepalese', '/images/bridge-family.webp', 'BRING THE KIDS', 'Harnessed from 10 years up, parents right behind.', NULL, 3),
  ('bicycle', '/images/bicycle-sky.webp', 'THE FULL SPAN', 'Over the lake, the Kids Park and out towards the ocean.', NULL, 0),
  ('bicycle', '/images/bicycle-pair.webp', 'SIDE BY SIDE', 'Two cables, so you cross together and can still hear the laughing.', NULL, 1),
  ('bicycle', '/images/bicycle-behind.webp', 'JUST PEDAL', 'Harness on, feet on the pedals, the cable does the rest.', NULL, 2),
  ('bicycle', '/images/bicycle-joy.webp', 'NO HANDS NEEDED', 'Most people forget to be scared about ten metres in.', NULL, 3),
  ('luge', '/images/luge-duo-curve.webp', 'THE TRACK', 'Chevrons, banked bends and a fight for the inside line.', NULL, 0),
  ('luge', '/images/luge-family.webp', 'RIDE TOGETHER', 'Little ones ride in front, grown-ups steer behind.', NULL, 1),
  ('luge', '/images/luge-race.webp', 'HEAD TO HEAD', 'Two karts, one finish line, no engines.', NULL, 2),
  ('luge', '/images/luge-joy.webp', 'THE FACE', 'This is the photo you will buy at the kiosk.', NULL, 3),
  ('private', '/images/expedition-raptor-ocean.webp', 'THE OCEAN RIDGE', 'Park where the valley opens onto the southern sea.', NULL, 0),
  ('private', '/images/expedition-raptor-earth.webp', '23 COLOURED EARTH', 'Pull up beside the dunes, no crowd, no queue.', NULL, 1),
  ('private', '/images/expedition-guide-guests.webp', 'YOUR GUIDE', 'A local storyteller for the whole three hours.', NULL, 2);

-- map_pins
INSERT INTO map_pins (code, px, py, kind, name, sub, image, btn_label, experience_id, go_target, sort_order) VALUES
  ('A', 49.4, 59.6, 'main', 'Park Entrance & Reception', 'Your trail starts here: tickets, briefing, photo kiosk, cafeteria and toilets right by the gate.', '/images/trail-reception.webp', 'Plan your visit', NULL, 'plan', 0),
  ('B', 62, 44.4, 'main', 'La Tour Viewpoint', 'The first summit, at 367 m. Beyond it rise The Peak (602 m) and Piton Savanne, tallest at 666 m.', '/images/trail-viewpoint.webp', NULL, 'peak', NULL, 1),
  ('C', 72.3, 39.5, 'main', 'Chamouzé Restaurant', 'Dine beside the cascading waterfall. Mauritian and European fusion, open daily 11:30 to 16:30.', '/images/chamouze-restaurant.webp', 'See the restaurant', NULL, 'chamouze', 2),
  ('D', 57.1, 55.7, 'main', 'Rock Garden', NULL, '/images/rock-garden-trail.webp', NULL, 'rock', NULL, 3),
  ('E', 83.3, 29.9, 'main', 'Vacoas Waterfall', '8 to 9 m high and 16 to 18 m wide, named after the rare Vacoas plants preserved around it.', '/images/vacoas-waterfall.webp', NULL, 'waterfalls', NULL, 4),
  ('F', 84.2, 21, 'main', '23 Coloured Earth', NULL, '/images/coloured-earth.webp', NULL, 'coloured', NULL, 5),
  ('G', 44.1, 9.9, 'main', 'Luge Kart Zone', 'The top of the loop. Catch the gravity powered Mountain Luge Kart back down if your legs vote no.', '/images/mountainlugecart.avif', NULL, 'luge', NULL, 6),
  ('H', 43.7, 31.2, 'main', 'La Citronelle', 'Refined Indian cuisine in a rustic lakeside setting. Events up to 400 guests.', '/images/la-citronelle-4.avif', 'See the restaurant', NULL, 'citronelle', 7),
  ('I', 50.9, 42.1, 'main', 'Kids Park', 'Pirate Ship, mini quads, roller coasters and the Kaz Bon Bon sweets kiosk, all in one fenced zone.', '/images/pirateship.avif', 'See Kids Park', NULL, 'kids', 8),
  ('J', 32.2, 56.7, 'main', 'La Bigarade', 'Vallé’s events venue on the western loop: weddings, corporate days and celebrations.', '/images/trail-bigarade.webp', 'Plan your visit', NULL, 'plan', 9),
  ('GZ', 40.9, 49.4, 'sub', 'Green Zone Wildlife', 'Aldabra giant tortoises roam free beside Mauritius’ rarest residents: four albino deer named Kiri, Mendy, Blanche and Avalanche.', '/images/trail-tortoise.webp', NULL, 'animals', NULL, 10),
  ('W', 87.1, 42.6, 'sub', 'Chamouzé Waterfall', '15 m of pure stillness, and the only waterfall in Mauritius you can zipline across.', '/images/chamouze-waterfall.webp', NULL, 'waterfalls', NULL, 11);

-- restaurants
INSERT INTO restaurants (id, name, badge, image, tag, cuisine, hours_label, price_label, setting_label, about, detail, menu_pdf, sort_order) VALUES
  ('chamouze', 'Le Chamouzé', 'WATERFALL DINING', '/images/lechamouze.avif', 'Dine beside the cascading Chamouzé waterfall, mid-trail.', 'Mauritian & European fusion', 'Daily · 11:30 – 16:30', 'Menus Rs 700 – 4,250', 'Beside the waterfall', 'A terrace set right against the Chamouzé falls, close enough to feel the spray. The kitchen pairs Mauritian classics with European technique: palm-heart salads, grilled catch of the day and slow braises, plus a kids menu for small adventurers. Come up for lunch between two ziplines, or settle in for the afternoon with the waterfall as your soundtrack.', 'Set menus from Rs 700 to Rs 4,250 · vegetarian options · the only restaurant in Mauritius where a zipline crosses the view.', '/menus/le-chamouze-menu.pdf', 0),
  ('citronelle', 'La Citronelle', 'RIVERSIDE · EVENTS TO 400', '/images/la-citronelle-4.avif', 'Refined Indian cuisine in a rustic lakeside setting.', 'Refined Indian', 'Daily · 11:30 – 16:30', 'À la carte from Rs 600', 'Lakeside, near the entrance', 'A rustic lakeside pavilion serving refined Indian cuisine: tandoor grills, slow-simmered curries and fresh naan, with generous vegetarian choices. The riverside deck hosts weddings and corporate days for up to 400 guests, and quiet valley lunches the rest of the time.', 'À la carte from Rs 600 · vegetarian friendly · event and group bookings via the sales team.', '/menus/la-citronelle-menu.pdf', 1);

-- restaurant_gallery
INSERT INTO restaurant_gallery (restaurant_id, src, sort_order) VALUES
  ('chamouze', '/images/lechamouze.avif', 0),
  ('chamouze', '/images/le-chamouze-dessert-plate.avif', 1),
  ('chamouze', '/images/le-chamouze-grilled-steak.avif', 2),
  ('chamouze', '/images/le-chamouze-catch-of-the-day-fries.avif', 3),
  ('chamouze', '/images/le-chamouze-restaurant-entrance.avif', 4),
  ('chamouze', '/images/le-chamouze-bartender-cocktail.avif', 5),
  ('citronelle', '/images/la-citronelle-4.avif', 0),
  ('citronelle', '/images/la-citronelle-dining-hall.avif', 1),
  ('citronelle', '/images/la-citronelle-garden-lawn.avif', 2),
  ('citronelle', '/images/la-citronelle-entrance-hall.avif', 3),
  ('citronelle', '/images/la-citronelle-mauritian-thali.avif', 4);

-- menu_groups
INSERT INTO menu_groups (id, restaurant_id, title, sort_order) VALUES
  (1, 'chamouze', 'PACKAGE OFFERS · PER PERSON', 0),
  (2, 'chamouze', 'STONE COOKING · FOR TWO', 1),
  (3, 'chamouze', 'STARTERS', 2),
  (4, 'chamouze', 'MAINS & SIZZLERS', 3),
  (5, 'citronelle', 'THALI', 0),
  (6, 'citronelle', 'INDIAN & MAURITIAN CORNER', 1),
  (7, 'citronelle', 'PASTA', 2),
  (8, 'citronelle', 'DESSERTS & DRINKS', 3);

-- menu_items
INSERT INTO menu_items (group_id, name, note, price_label, sort_order) VALUES
  (1, 'Menu 1', 'Starter, main, dessert, drinks & coffee · European or Mauritian Otentiks', 'Rs 2,700', 0),
  (1, 'Menu 2 · Shisha Cabana', 'All food & drinks + 25 min shisha session', 'Rs 5,000', 1),
  (1, 'Menu 3 · All Inclusive', 'All foods & drinks on the privileged decking', 'Rs 9,000', 2),
  (1, 'Couple Decking Experience', 'Stone cooking, shisha & butler service, for 2', 'Rs 26,500', 3),
  (2, 'Package 1', 'Wagyu beef, scallops, lobster tail, lamb, salmon + burrata salad', 'Rs 19,500', 0),
  (2, 'Package 2', 'Chicken, dorado, calamari, shrimps, mussels + golgappas', 'Rs 10,200', 1),
  (3, 'Burrata Salad', 'Rocket, frozen Mauritian tomatoes, balsamic', 'Rs 690', 0),
  (3, 'Golgappas Verrines', 'Four fillings, vegetarian', 'Rs 690', 1),
  (3, 'Tetralogy of Gazpachos', 'Chef’s creativity, vegetarian', 'Rs 605', 2),
  (3, 'Béchamel Seafood Gratin', '', 'Rs 690', 3),
  (3, 'Goat Cheese Honey Glazed', '', 'Rs 650', 4),
  (3, 'Dim Sum for Two', '20 pieces, veg or non-veg', 'Rs 1,550', 5),
  (3, 'Mussels Pot', 'A couple’s break, with bread & gravy', 'Rs 2,500', 6),
  (3, 'Kids Menu', 'Chicken burger, penne or fish beignet', 'Rs 600', 7),
  (4, 'Deer or Wagyu Beef Sizzler', '', 'Rs 2,500', 0),
  (4, 'Giant Prawns Sizzler', '', 'Rs 1,800', 1),
  (4, 'Chicken Sizzler', '', 'Rs 1,200', 2),
  (4, 'Mixed Vegetables Sizzler', '', 'Rs 990', 3),
  (4, 'Finger Licking Seafood', 'Spiny lobster, crab, calamari, giant prawns · for 1 / for 2', 'Rs 3,500 / 6,500', 4),
  (4, 'South African Rib Eye Steak', '', 'Rs 1,550', 5),
  (4, 'Chamouzé Famous Souris', 'Lamb shank, garlic, rosemary & thyme', 'Rs 1,340', 6),
  (4, 'Summer Grilled Fish', 'Yellowfin tuna or dorado', 'Rs 1,010', 7),
  (5, 'Veg Thali', 'Chole masala, malai kofta, aloo jeera, dal makhani, rice, chapati, gulab jamun', 'Rs 600 · couple Rs 1,000', 0),
  (5, 'Non-Veg Thali', 'The veg thali plus butter chicken', 'Rs 600 · couple Rs 1,000', 1),
  (6, 'Fish Curry', 'With rice, cooked grains or mixed salad', 'Rs 500', 0),
  (6, 'Chicken Curry', 'With rice, cooked grains or mixed salad', 'Rs 500', 1),
  (6, 'Fried Rice', 'Chicken & egg Rs 500 · vegetarian Rs 400', 'Rs 400 / 500', 2),
  (6, 'Fried Noodles', 'Chicken & egg Rs 500 · vegetarian Rs 400', 'Rs 400 / 500', 3),
  (7, 'Spaghetti', 'Arrabbiata (red) or mushroom (white) · add sautéed chicken +Rs 100', 'Rs 400', 0),
  (8, 'Ice-Cream', '', 'Rs 150', 0),
  (8, 'Indian Sweets', '', 'Rs 100', 1),
  (8, 'Fiesta Pear', '', 'Rs 200', 2),
  (8, 'Fiesta Apple', '', 'Rs 150', 3),
  (8, 'Fresh Juice', '', 'Rs 150', 4),
  (8, 'Water', '', 'Rs 150', 5);

SELECT setval(pg_get_serial_sequence('menu_groups','id'), 8);

-- package_tiers
INSERT INTO package_tiers (id, family, name, badge, color, fg, image, single_label, dbl_label, note, hero, sort_order) VALUES
  (1, 'ls', 'Light', 'EASY START', '#33FF74', '#340057', '/images/quadbuggy.avif', 'Rs 11,100', 'Rs 19,450', 'Does not include the Signature Zipline.', NULL, 0),
  (2, 'ls', 'Standard', 'MOST POPULAR', '#7333FF', '#FFFFFF', '/images/ziplineadventures.avif', 'Rs 11,950', 'Rs 21,750', 'Includes the Signature Zipline.', NULL, 1),
  (3, 'ex', 'Bronze', NULL, '#C77B4F', NULL, '/images/waterfalls.avif', 'Rs 16,575', 'Rs 21,625', NULL, 'Waterfall Zipline (300 m, 2 lines)', 0),
  (4, 'ex', 'Silver', NULL, '#AEB6C2', NULL, '/images/thepeak.avif', 'Rs 17,200', 'Rs 23,075', NULL, 'The Signature Zipline (1.5 km)', 1),
  (5, 'ex', 'Gold', NULL, '#E3B341', NULL, '/images/nepalesebridge.avif', 'Rs 19,400', 'Rs 27,300', NULL, 'Sky Pulse Tour (3.1 km, 7 lines)', 2),
  (6, 'ex', 'Platinum', NULL, '#93A1B8', NULL, '/images/bicyclezipline.avif', 'Rs 23,800', 'Rs 32,175', NULL, 'Advenature Flight (5.5 km, 11 lines)', 3),
  (7, 'diamond', 'Diamond', 'NR · SOUVENIR GIFT OFFERED', '#7333FF', '#FFFFFF', '/images/expedition-raptor-ocean.webp', 'Rs 120,000', 'Rs 149,000', 'Non-resident rate. The double includes two GoPro rentals. A special souvenir gift is offered.', 'The whole valley, a hunting expedition and your own film', 0),
  (8, 'resident', 'Ventu Rush', NULL, '#33FF74', '#340057', '/images/luge-family.webp', 'Rs 1,700', '', NULL, 'Three classics in one afternoon', 0),
  (9, 'resident', 'Triple Thrill', NULL, '#FFFC33', '#340057', '/images/zipline-waterfall.webp', 'Rs 2,025', '', NULL, 'Add the waterfall crossing', 1),
  (10, 'resident', 'Adventure Lust', NULL, '#FF3358', '#FFFFFF', '/images/zipline-superman.webp', 'Rs 2,725', '', NULL, 'The Signature, 1.5 km across the valley', 2),
  (11, 'resident', 'Elysian Escape', NULL, '#7333FF', '#FFFFFF', '/images/zipline-duo.webp', 'Rs 3,950', '', NULL, 'Seven lines plus every suspended thrill', 3),
  (12, 'senior', 'Package 1', 'AGES 55 AND ABOVE', '#33FF74', '#340057', '/images/trail-tortoise.webp', 'Rs 1,100', '', 'Lunch: rice, fish curry, chicken blanquette with vegetables, salad, ice cream, water and soft drinks. Veg options available.', 'A gentle day in the valley', 0),
  (13, 'senior', 'Package 2', 'AGES 55 AND ABOVE', '#FFFC33', '#340057', '/images/expedition-guide-guests.webp', 'Rs 1,500', '', 'Same lunch menu as Package 1. Veg options available.', 'See it all by jeep', 1);

-- package_tier_items
INSERT INTO package_tier_items (tier_id, text, sort_order) VALUES
  (1, 'Admission fee', 0),
  (1, 'Quad Adventure (1 h)', 1),
  (1, 'Discovery Tour ziplines (7 lines)', 2),
  (1, 'Nepalese Bridge (350 m)', 3),
  (1, 'Lunch, Discovery Menu', 4),
  (2, 'Admission fee', 0),
  (2, 'Quad Adventure (1 h)', 1),
  (2, 'Sky Pulse Tour (7 lines)', 2),
  (2, 'Nepalese Bridge (350 m)', 3),
  (2, 'Lunch, Discovery Menu', 4),
  (3, 'Admission fee', 0),
  (3, 'Quad Discovery', 1),
  (3, 'The Peak', 2),
  (3, 'Waterfall Zipline (300 m, 2 lines)', 3),
  (3, 'Nepalese Bridge (350 m)', 4),
  (3, 'Mountain Luge Kart (1 ride)', 5),
  (3, 'GoPro rental, full day', 6),
  (4, 'Admission fee', 0),
  (4, 'Quad Discovery', 1),
  (4, 'The Peak', 2),
  (4, 'The Signature Zipline (1.5 km)', 3),
  (4, 'Nepalese Bridge (350 m)', 4),
  (4, 'Mountain Luge Kart (1 ride)', 5),
  (4, 'GoPro rental, full day', 6),
  (5, 'Admission fee', 0),
  (5, 'Quad Adventure', 1),
  (5, 'The Peak', 2),
  (5, 'Sky Pulse Tour (3.1 km, 7 lines)', 3),
  (5, 'Nepalese Bridge', 4),
  (5, 'Mountain Luge Kart (1 ride)', 5),
  (5, 'GoPro rental, full day', 6),
  (6, 'Admission fee', 0),
  (6, 'Exclusive Quad Adventure', 1),
  (6, 'The Peak', 2),
  (6, 'Advenature Flight (5.5 km, 11 lines)', 3),
  (6, 'Nepalese Bridge', 4),
  (6, 'Mountain Luge Kart (1 ride)', 5),
  (6, 'GoPro rental, full day', 6),
  (7, 'Admission fee', 0),
  (7, 'Private guide & transfer + butler service', 1),
  (7, 'Exclusive Quad Adventure (1 hour)', 2),
  (7, 'Advenature Flight (5.5 km, 11 lines)', 3),
  (7, 'Bicycle Zipline (max 100 kg)', 4),
  (7, 'Mountain Luge Kart (3 rides)', 5),
  (7, 'Nepalese Bridge', 6),
  (7, 'Stone-cooking lunch at Le Chamouzé', 7),
  (7, 'The Peak', 8),
  (7, 'Snacks and beverages in any outlet', 9),
  (7, 'GoPro rental (full day) + photo', 10),
  (7, '3-hour hunting expedition', 11),
  (7, 'Cinematic video of your complete day', 12),
  (8, 'Mountain Luge Kart (1 ride)', 0),
  (8, 'Nepalese Bridge', 1),
  (8, 'Bicycle Zipline', 2),
  (9, 'Mountain Luge Kart (1 ride)', 0),
  (9, 'Nepalese Bridge OR Bicycle Zipline', 1),
  (9, 'Waterfall Zipline (300 m, 2 lines)', 2),
  (10, 'Signature Zipline (1.5 km)', 0),
  (10, 'Nepalese Bridge OR Bicycle Zipline', 1),
  (10, 'Mountain Luge Kart (1 ride)', 2),
  (11, 'The Discovery Tour (1.6 km, 7 lines)', 0),
  (11, 'Nepalese Bridge', 1),
  (11, 'Bicycle Zipline', 2),
  (11, 'Mountain Luge Kart (1 ride)', 3),
  (12, 'Entrance visit', 0),
  (12, 'Lunch', 1),
  (12, 'Tea break', 2),
  (13, 'Visit by jeep (45 min)', 0),
  (13, 'Lunch', 1),
  (13, 'Tea break', 2);

SELECT setval(pg_get_serial_sequence('package_tiers','id'), 13);

-- package_addons
INSERT INTO package_addons (text, price_label, sort_order) VALUES
  ('Bicycle Zipline (max 100 kg)', 'S Rs 1,150 · D Rs 2,300', 0),
  ('Stone-cooking lunch', 'S Rs 10,000 · D Rs 18,000', 1),
  ('Full-day cinematic video', 'Rs 20,000', 2),
  ('Swing Experience (with dress)', 'Rs 3,500', 3),
  ('Private guide (zipline & quad)', 'Rs 5,000', 4),
  ('Discovery Menu lunch', 'Rs 2,300 pp', 5);

-- vip_items
INSERT INTO vip_items (text, sort_order) VALUES
  ('Admission fee & The Peak', 0),
  ('Exclusive Quad Adventure (1 h)', 1),
  ('Advenature Flight (5.5 km, 11 lines)', 2),
  ('Nepalese Bridge', 3),
  ('Bicycle Zipline', 4),
  ('Mountain Luge Kart (3 rides)', 5),
  ('Lunch + snacks & beverages in any outlet', 6),
  ('Private guide, transfer & butler service', 7),
  ('GoPro rental (full day) + photo', 8),
  ('Souvenir gift', 9);

-- combos
INSERT INTO combos (id, name, color, rr_single, rr_dbl, nr_single, nr_dbl, sort_order) VALUES
  (1, 'Ace', '#33FF74', 5375, 8600, 7400, 12100, 0),
  (2, 'Conqueror', '#FF3358', 6350, 10550, 8900, 14975, 1);

-- combo_items
INSERT INTO combo_items (combo_id, text, sort_order) VALUES
  (1, 'Quad Adventure Track · 1 h', 0),
  (1, 'The Discovery Tour · 1.6 km, 7 lines', 1),
  (2, 'Quad Adventure Track · 1 h', 0),
  (2, 'Sky Pulse Tour · 3.1 km, 7 lines', 1);

SELECT setval(pg_get_serial_sequence('combos','id'), 2);

-- cinematic_items
INSERT INTO cinematic_items (name, price, sort_order) VALUES
  ('Koi Pond Experience', 4000, 0),
  ('Swing Experience', 2500, 1),
  ('Swing Experience · with dress', 4000, 2),
  ('Cinematic Package · 1 activity', 12000, 3),
  ('Cinematic Package · 2 activities', 14000, 4),
  ('Cinematic Package · 3 activities', 16000, 5),
  ('Cinematic Full Day', 20000, 6);

-- price_list
INSERT INTO price_list (group_key, label, rr, nr, sort_order) VALUES
  ('admission', '12 years old & above', 400, 550, 0),
  ('admission', '6 to 11 years old', 275, 325, 1),
  ('admission', '1 to 5 years old', 0, 0, 2),
  ('zipline', 'The Plunge · 500 m, 1 line', 875, 1375, 0),
  ('zipline', 'Waterfall Zipline · 300 m, 2 lines', 1025, 1950, 1),
  ('zipline', 'The Signature · 1.5 km, 1 line', 1725, 2850, 2),
  ('zipline', 'Discovery Tour · 1.6 km, 7 lines', 2250, 3600, 3),
  ('zipline', 'Adventure Tour · 2.4 km, 6 lines', 2350, 2950, 4),
  ('zipline', '10 Flight Trail · 3.5 km, 10 lines', 2900, 4150, 5),
  ('zipline', 'Sky Pulse Tour · 3.1 km, 7 lines', 3250, 4975, 6),
  ('zipline', 'Advenature Flight · 5.5 km, 11 lines', 3950, 5650, 7),
  ('quad', 'Quad Discovery 1 h · standard, single', 2800, 3600, 0),
  ('quad', 'Quad Discovery 1 h · standard, double', 3800, 4700, 1),
  ('quad', 'Quad Adventure 1 h · standard, single', 3125, 3950, 2),
  ('quad', 'Quad Adventure 1 h · standard, double', 4100, 5150, 3),
  ('quad', 'Advenature Tour 2 h · standard, single', 4300, 5250, 4),
  ('quad', 'Advenature Tour 2 h · standard, double', 5075, 6250, 5),
  ('quad', 'Exclusive Quad 625cc · from', 6450, 7600, 6),
  ('buggy', 'Buggy Discovery · 1 h', 6200, 7500, 0),
  ('buggy', 'Buggy 4X · 1 h', 10900, 13500, 1),
  ('buggy', 'Buggy Exclusive 2 pax · 1 h 30', 12150, 15500, 2),
  ('buggy', 'Buggy Exclusive 4 pax · 1 h 30', 16300, 19500, 3),
  ('luge', '1 ride', 500, 700, 0),
  ('luge', '2 rides', 775, 1025, 1),
  ('luge', '3 rides', 1000, 1300, 2),
  ('bicycle', 'Bicycle Zipline · 400 m', 700, 1150, 0),
  ('nepalese', 'Nepalese Bridge · 350 m', 700, 1300, 0),
  ('peak', 'Explorer''s Drive to The Peak · 1 h', 3850, 4900, 0),
  ('peak', 'Elite Expedition', 8000, 8000, 1),
  ('private', 'Private Vallé Expedition · 2 pax', 3350, 4250, 0),
  ('private', 'Private Vallé Expedition · 3 pax', 3575, 4550, 1),
  ('private', 'Private Vallé Expedition · 4 pax', 3650, 4650, 2),
  ('private', 'Private guide · per guide, per activity', 1500, 1500, 3),
  ('group', 'Group Expedition · per person, min 5 pax', 1100, 1350, 0),
  ('student', 'Entrance fee · visit of the park', 200, 200, 0),
  ('student', 'Nepalese Bridge · 350 m', 375, 375, 1),
  ('student', 'Mountain Luge Kart · 1 ride', 325, 325, 2),
  ('student', 'Mountain Luge Kart · 2 rides', 475, 475, 3),
  ('student', 'Mountain Luge Kart · 3 rides', 750, 750, 4),
  ('student', 'Smallest Zipline · 190 m, min 20 pax', 200, 200, 5),
  ('student', 'The Plunge · 500 m', 500, 500, 6),
  ('student', 'The Waterfall Zipline', 550, 550, 7),
  ('student', 'Signature Zipline · 1.5 km', 800, 800, 8),
  ('student', 'The Discovery Tour Zipline · 1.6 km, 7 lines', 1000, 1000, 9),
  ('student', 'Sky Pulse Tour · 3.1 km, 7 lines', 2000, 2000, 10),
  ('student', 'Bicycle Zipline', 350, 350, 11),
  ('student', 'Lunch menu · 4 to 11 yrs', 250, 250, 12),
  ('student', 'Lunch menu · 12 yrs and over', 300, 300, 13),
  ('kids', 'Mini Quad', 200, 300, 0),
  ('kids', 'Roller Coaster Zipline', 200, 300, 1),
  ('kids', 'Roller Coaster Express', 200, 300, 2),
  ('kids', 'Mini Excavator', 200, 300, 3),
  ('kids', 'Pirate Ship', 200, 300, 4);

-- photo_tiers
INSERT INTO photo_tiers (rate, name, color, activities_label, single_label, dbl_label, sort_order) VALUES
  ('rr', 'Bronze', '#C77B4F', '1 activity', 'Rs 850', 'Rs 1,050', 0),
  ('rr', 'Silver', '#AEB6C2', '2 activities', 'Rs 1,050', 'Rs 1,250', 1),
  ('rr', 'Gold', '#E3B341', '3 activities', 'Rs 1,250', 'Rs 1,450', 2),
  ('rr', 'Platinum', '#93A1B8', 'Full activities', 'Rs 1,600', 'Rs 1,800', 3),
  ('nr', 'Bronze', '#C77B4F', '1 activity', 'Rs 1,200', 'Rs 1,400', 0),
  ('nr', 'Silver', '#AEB6C2', '2 activities', 'Rs 1,500', 'Rs 1,900', 1),
  ('nr', 'Gold', '#E3B341', '3 activities', 'Rs 1,700', 'Rs 2,100', 2),
  ('nr', 'Platinum', '#93A1B8', '4 activities', 'Rs 2,175', 'Rs 2,575', 3);

-- photo_addons
INSERT INTO photo_addons (rate, text, price_label, sort_order) VALUES
  ('rr', 'Additional printed photo', 'Rs 400 / print', 0),
  ('rr', 'Per additional person, digital only', 'Rs 550', 1),
  ('nr', 'Additional printed photo', 'Rs 400 / print', 0),
  ('nr', 'Per additional person, digital only', 'Rs 700', 1);

-- team_packs
INSERT INTO team_packs (id, image, sort_order) VALUES
  (1, '/images/mountainlugecart.avif', 0),
  (2, '/images/nepalesebridge.avif', 1),
  (3, '/images/ziplineadventures.avif', 2);

-- team_pack_items
INSERT INTO team_pack_items (team_pack_id, text, sort_order) VALUES
  (1, 'Fun games (2 to 3 h)', 0),
  (1, 'Mountain Luge Kart (1 ride)', 1),
  (1, 'Wellness lunch', 2),
  (1, 'Water 0.5 L per person', 3),
  (2, 'Fun games (2 to 3 h)', 0),
  (2, 'Waterfall Zipline', 1),
  (2, 'Nepalese Bridge (350 m)', 2),
  (2, 'Wellness lunch', 3),
  (2, 'Water 0.5 L per person', 4),
  (3, 'Fun games (2 to 3 h)', 0),
  (3, 'Nepalese Bridge (350 m)', 1),
  (3, 'Mountain Luge Kart (1 ride)', 2),
  (3, 'The Plunge zipline (500 m)', 3),
  (3, 'Wellness lunch', 4),
  (3, 'Water 0.5 L per person', 5);

SELECT setval(pg_get_serial_sequence('team_packs','id'), 3);

-- hero_slides
INSERT INTO hero_slides (src, sort_order) VALUES
  ('/images/valle-zipline-adventure-mauritius.avif', 0),
  ('/images/valle-waterfall-nature-trail-mauritius.avif', 1),
  ('/images/valle-quad-bike-adventure-mauritius.avif', 2),
  ('/images/valle-23-colored-earth-chamouny.avif', 3),
  ('/images/valle-giant-tortoise-park-mauritius.avif', 4);

-- settings
INSERT INTO settings (key, value) VALUES
  ('entry_adult', '500'),
  ('entry_child', '250'),
  ('park_name', 'VALLÉ Advenature™ Park'),
  ('whatsapp', '+23052928841'),
  ('email', 'sales@vallepark.com'),
  ('phone', '+230 660 44 77'),
  ('hours', 'Open daily 09:00 – 17:30');

-- staff_users
INSERT INTO staff_users (email, name, role, password_hash) VALUES
  ('sales@vallepark.com', 'Sales & Reservations', 'manager', '$2b$12$CCuxe/PRFDZ/K5m41WfXluFyMLr4L/kbXv7/Pf9.vd3/QsdFpmlsq'),
  ('agent@vallepark.com', 'Reservations Agent', 'agent', '$2b$12$XA.wxs20zFYndzTe9c4I.uBgxKNWnhP8vgXAP/kaH8lHzdwfdVfuG'),
  ('hr@vallepark.com', 'People & Careers', 'hr', '$2b$12$y8YCBiUnEI0PHudo/8zrFuMYB66jWgQC449RSj4oyirc3dnh56GCS');

-- job_vacancies
INSERT INTO job_vacancies (slug, title, department, employment, summary, description, requirements, benefits, salary_range, status) VALUES
  ('zipline-guide', 'Zipline Guide', 'Adventure', 'full-time', 'Run the lines, brief the flyers and keep every launch safe.', 'You will run guests through the safety briefing, fit and check harnesses, and dispatch flights across our eight zipline routes, from the 300 m waterfall hop to the 5.5 km Advenature Flight. Most of your day is outdoors on the platforms with a small team.', 'Comfortable working at height, all day, in all weather
Confident spoken English and French; Creole is a plus
Calm and clear with nervous first-time flyers
Physically fit: the platforms are reached on foot
Rope-access or outdoor-instruction certification is an advantage, training is provided', 'Full safety training, uniform, staff meal, park access for family on days off.', 'Negotiable, based on experience', 'published'),
  ('reservations-agent', 'Reservations Agent', 'Sales & Reservations', 'full-time', 'First voice of the park: take bookings, answer questions, build the day.', 'You will handle incoming bookings by phone, email and live chat, build packages for families and groups, and hand a clean arrivals list to the gate team each morning.', 'Excellent written and spoken English and French
Comfortable working across a booking system, email and live chat at once
Accurate with numbers: our rates differ for residents and visitors
Previous hospitality or contact-centre experience preferred', 'Weekday hours, staff meal, park access for family on days off.', 'Rs 22,000 to Rs 28,000 per month', 'published'),
  ('chef-de-partie-chamouze', 'Chef de Partie, Le Chamouzé', 'Food & Beverage', 'full-time', 'Cook Mauritian and European plates beside a waterfall.', 'Run your section of the Chamouzé kitchen for a 60-cover lunch service, working with the head chef on menus that pair Mauritian classics with European technique.', 'At least two years in a professional kitchen
Confident on your own section during a busy service
Food-hygiene certification or willingness to obtain one', 'Split shifts finish early, staff meal, uniform and laundry.', 'Rs 25,000 to Rs 32,000 per month', 'published'),
  ('seasonal-kids-park-host', 'Kids Park Host (Seasonal)', 'Kids Park', 'seasonal', 'Keep the Kids Park zone running, safe and full of laughing.', 'Supervise the pirate ship, mini quads, roller coasters and the Kaz Bon Bon kiosk through the peak season, keeping ride queues moving and parents informed.', 'Genuinely enjoys working with children aged 3 to 12
Patient, watchful and safety-first
Available weekends and school holidays', 'Seasonal contract with a route into a permanent role.', 'Rs 16,000 per month', 'published');

COMMIT;
