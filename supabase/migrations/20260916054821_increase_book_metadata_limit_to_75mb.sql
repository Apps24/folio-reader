alter table public.books drop constraint books_size_check;
alter table public.books add constraint books_size_check
  check (size between 1 and 75 * 1024 * 1024);
