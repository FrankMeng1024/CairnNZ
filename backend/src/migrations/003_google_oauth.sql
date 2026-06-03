-- Migration 003: Add google_sub column to users table for Google OAuth
ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) NULL AFTER password_hash;
ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL;
