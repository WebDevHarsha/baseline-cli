#!/usr/bin/env node
import figlet from "figlet";
import { pastel } from "gradient-string";

function main(){
    startMsg();
    
}

function startMsg(){
    console.clear();
    const startMsg=`Welcome     to \n Baseline   -   CLI`

    figlet(startMsg, (err, data) => {
        console.log(pastel.multiline(data))
        if(err){
            console.log("oops we have an issue...")
        }
    })
}

main();