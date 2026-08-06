<?php
$conn = new mysqli('localhost', 'agent_wp', 'AiAgent2026!', 'agent_wp');
$result = $conn->query("SELECT post_content FROM wp_posts WHERE ID=2985 LIMIT 1");
$row = $result->fetch_assoc();
$content = $row['post_content'];

// Extract all img src
preg_match_all('/<img[^>]+src="([^"]+)"/i', $content, $matches);
echo "Images in post_content:\n";
foreach ($matches[1] as $i => $src) {
    echo "  [$i] $src\n";
}
echo "\nTotal: " . count($matches[1]) . " images\n";
$conn->close();
