<?php
/**
 * 重新生成 WordPress 图片缩略图元数据
 * 用法：php /tmp/regen_thumbs.php
 */
define('ABSPATH', '/www/wwwroot/agent.eake.cn/');
require_once(ABSPATH . 'wp-load.php');

echo "Starting thumbnail regeneration...\n";

// 找所有 post_type=attachment 的图片
$attachments = get_posts([
    'post_type' => 'attachment',
    'post_mime_type' => 'image',
    'posts_per_page' => -1,
]);

echo "Found " . count($attachments) . " images\n";

$count = 0;
foreach ($attachments as $att) {
    $file = get_attached_file($att->ID);
    if (!file_exists($file)) {
        echo "  [SKIP] {$att->ID}: file not found - $file\n";
        continue;
    }

    // 用 wp_generate_attachment_metadata 重新生成
    $metadata = wp_generate_attachment_metadata($att->ID, $file);

    if (!empty($metadata['sizes'])) {
        wp_update_attachment_metadata($att->ID, $metadata);
        echo "  [OK] {$att->ID}: " . count($metadata['sizes']) . " sizes regenerated\n";
        $count++;
    } else {
        echo "  [WARN] {$att->ID}: no sizes generated\n";
    }
}

echo "\nDone. Regenerated $count images.\n";