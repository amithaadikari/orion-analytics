# Supabase setup

1. Create a project and copy the URL, anon key and service-role key.
2. Run the migration in the SQL editor.
3. Enable Authentication → Providers → Email.
4. Create the first user, copy the Auth UUID, and run:

```sql
insert into public.admins (user_id, email, role)
values ('AUTH_USER_UUID', 'you@example.com', 'admin');
```

5. Confirm the user can sign in at `/login`. The `admins` policy exposes only the signed-in user's own approval row, while visitor/session/event rows are readable only through the approved-admin policy.

The public tracking API uses the server-only service role, so do not add anonymous insert policies. Rotate the service-role key if it is ever exposed.
