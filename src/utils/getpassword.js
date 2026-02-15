// generateHash.js
import bcrypt from "bcrypt";

async function generate() {
    const password = "123456";
    const saltRounds = 10;

    const hash = await bcrypt.hash(password, saltRounds);
    console.log("Hashed Password:");
    console.log(hash);
}

generate();
