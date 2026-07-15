-- Run only in a non-production project. Replace the UUID with an auth.users id.
-- insert into public.admins (user_id, email, role) values ('AUTH_USER_UUID', 'admin@example.com', 'admin') on conflict (user_id) do nothing;

insert into public.visitors (visitor_id, first_seen, last_seen, country, city, device_type, browser, operating_system, landing_page, utm_source, utm_medium, utm_campaign)
values
  ('v_seed_00000001', now() - interval '2 days', now() - interval '1 hour', 'US', 'New York', 'desktop', 'Chrome', 'Apple', 'https://orion.example/?utm_campaign=summer', 'meta', 'paid_social', 'summer'),
  ('v_seed_00000002', now() - interval '1 day', now() - interval '4 hours', 'GB', 'London', 'mobile', 'Safari', 'Apple', 'https://orion.example/', 'organic', 'referral', 'Organic'),
  ('v_seed_00000003', now() - interval '5 hours', now() - interval '5 hours', 'AU', 'Sydney', 'tablet', 'Chrome', 'Android', 'https://orion.example/?utm_campaign=summer', 'meta', 'paid_social', 'summer')
on conflict (visitor_id) do nothing;

insert into public.sessions (visitor_id, session_id, pages_viewed, duration_seconds)
values ('v_seed_00000001', 's_seed_00000001', 3, 184), ('v_seed_00000002', 's_seed_00000002', 1, 42), ('v_seed_00000003', 's_seed_00000003', 2, 93)
on conflict (session_id) do nothing;

insert into public.events (visitor_id, session_id, event_name, event_id, page_url, metadata)
values
  ('v_seed_00000001', 's_seed_00000001', 'PageView', 'evt_seed_page_0001', 'https://orion.example/', '{}'),
  ('v_seed_00000001', 's_seed_00000001', 'ViewContent', 'evt_seed_content_001', 'https://orion.example/', '{"content_name":"ORION SCALPER"}'),
  ('v_seed_00000001', 's_seed_00000001', 'TelegramClick', 'evt_seed_telegram_01', 'https://orion.example/', '{"source":"seed"}'),
  ('v_seed_00000002', 's_seed_00000002', 'PageView', 'evt_seed_page_0002', 'https://orion.example/', '{}'),
  ('v_seed_00000003', 's_seed_00000003', 'PageView', 'evt_seed_page_0003', 'https://orion.example/', '{}')
on conflict (event_id) do nothing;
