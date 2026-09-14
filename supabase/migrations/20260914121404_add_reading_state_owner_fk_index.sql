-- Covers the composite foreign key used when books cascade to reading state.
create index reading_state_book_owner
  on public.reading_state(book_id, user_id);
