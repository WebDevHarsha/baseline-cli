#!/usr/bin/env node
import figlet from "figlet";
import gradient from "gradient-string";

function main(){
    console.clear();
    const startMsg=`Welcome     to \n Baseline      CLI`

    figlet(startMsg, (err, data) => {
        console.log(gradient.pastel.multiline(data))
    })
}

main();