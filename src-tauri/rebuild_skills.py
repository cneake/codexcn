import sys

base_path = './src/skills_corrupted_backup.rs'
extra_path = './src/skills_extra.rs'
out_path = './src/skills.rs'

data = open(base_path, 'rb').read()
# The original clean file was 43077 bytes; corruption was only in the appended part.
clean_base = data[:43077]

# Verify clean base decodes as UTF-8
try:
    clean_base.decode('utf-8')
    print('clean_base decodes OK, len', len(clean_base))
except Exception as e:
    print('ERROR clean_base corrupt:', e)
    sys.exit(1)

extra = open(extra_path, 'rb').read()
try:
    extra.decode('utf-8')
    print('extra decodes OK, len', len(extra))
except Exception as e:
    print('ERROR extra corrupt:', e)
    sys.exit(1)

# Byte-level append (no re-encoding)
combined = clean_base.rstrip(b'\n') + b'\n' + extra.lstrip(b'\n')
combined.decode('utf-8')  # final verify
open(out_path, 'wb').write(combined)
print('wrote', out_path, 'len', len(combined))
sys.stdout.flush()
