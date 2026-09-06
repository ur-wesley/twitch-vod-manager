fn main() {
    println!("cargo:rerun-if-env-changed=TWITCH_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=TWITCH_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=YOUTUBE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=YOUTUBE_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=GDRIVE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GDRIVE_CLIENT_SECRET");
}
