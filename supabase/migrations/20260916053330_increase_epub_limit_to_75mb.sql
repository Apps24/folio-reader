update storage.buckets
set file_size_limit = 75 * 1024 * 1024
where id = 'epubs';
