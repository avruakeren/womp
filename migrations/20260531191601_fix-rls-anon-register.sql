-- Allow anon (unauthenticated) users to insert profiles during registration
CREATE POLICY "profiles_insert_public" ON profiles
  FOR INSERT TO public
  WITH CHECK (true);

GRANT INSERT ON profiles TO anon;

-- Allow anon users to read profiles for login & friend search
CREATE POLICY "profiles_select_public" ON profiles
  FOR SELECT TO public
  USING (true);

GRANT SELECT ON profiles TO anon;

-- anon can read friendships (RLS still filters via requester_id/addressee_id)
GRANT SELECT, INSERT ON friendships TO anon;

-- anon can read and insert messages (RLS still filters via sender_id/recipient_id)
GRANT SELECT, INSERT ON messages TO anon;
