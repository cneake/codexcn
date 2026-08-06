use qrcode::QrCode;

fn main() {
    let s1 = "b421879c6d6caddea1d625b719cc1a18";
    println!("Test1: len={}", s1.len());
    match QrCode::new(s1) {
        Ok(c) => println!("OK v={} w={}", c.version(), c.width()),
        Err(e) => println!("ERR {}", e),
    }
}
