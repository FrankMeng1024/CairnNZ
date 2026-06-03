-- Migration: Add friends, friend_requests, markers tables
-- Run: mysql -u root -p cairn < backend/src/migrations/003_friends_markers.sql

CREATE TABLE IF NOT EXISTS friend_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_user_id INT NOT NULL,
  to_user_id INT NOT NULL,
  status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
  created_at DATETIME NOT NULL,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_request (from_user_id, to_user_id)
);

CREATE TABLE IF NOT EXISTS friends (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  friend_id INT NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_friendship (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS markers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'free',
  text VARCHAR(30) DEFAULT '',
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  alt DOUBLE DEFAULT NULL,
  permission ENUM('personal', 'group', 'public') DEFAULT 'personal',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_markers_user (user_id),
  INDEX idx_markers_permission (permission),
  INDEX idx_markers_location (lat, lng)
);
