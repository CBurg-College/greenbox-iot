//////////////////////
//##################//
//##              ##//
//##  eserial.ts  ##//
//##              ##//
//##################//
//////////////////////

let g_init = false
let g_read: string[]
let g_write: string[]
g_read = []
g_write = []
let g_read_tmo = 0
let g_write_tmo = 0

let g_tx_dat: DigitalPin	// tx out data
let g_tx_rdy: DigitalPin	// tx out data valid
let g_tx_rcv: DigitalPin	// tx in  data received
let g_rx_dat: DigitalPin	// rx in  data
let g_rx_rdy: DigitalPin	// rx in  data valid
let g_rx_rcv: DigitalPin	// rx out data received

function initESerial() {
    pins.digitalWritePin(g_tx_rdy, 0)
    pins.digitalWritePin(g_tx_rdy, 0)
    pins.digitalWritePin(g_tx_rdy, 0)
    g_read = []
    g_write = []
}

function writeChar(char: string) {
    let ch = char.charCodeAt(0)
    let pin: number
    for (let i = 0; i < 8; i++) {
        pin = (ch & (1 << i))
        pins.digitalWritePin(g_tx_dat, pin == 0 ? 0 : 1)
        pins.digitalWritePin(g_tx_rdy, 1)
        while (!pins.digitalReadPin(g_tx_rcv)) {
            if (control.millis() > g_write_tmo) { initESerial(); return; }
        }
        pins.digitalWritePin(g_tx_rdy, 0)
        while (pins.digitalReadPin(g_tx_rcv)) {
            if (control.millis() > g_write_tmo) { initESerial(); return; }
        }
    }
}

function readChar(): string {
    let pin: number
    let ch = 0
    for (let i = 0; i < 8; i++) {
        while (!pins.digitalReadPin(g_rx_rdy)) {
            if (control.millis() > g_read_tmo) { initESerial(); return ""; }
        }
        pin = pins.digitalReadPin(g_rx_dat)
        ch |= (pin << i)
        pins.digitalWritePin(g_rx_rcv, 1)
        while (pins.digitalReadPin(g_rx_rdy)) {
            if (control.millis() > g_read_tmo) { initESerial(); return ""; }
        }
        pins.digitalWritePin(g_rx_rcv, 0)
    }
    let ret = (ch == 0 ? "" : String.fromCharCode(ch))
    return ret
}

// write strings
basic.forever(function () {
    if (!g_init) return;
    if (g_write.length > 0) {
        g_write_tmo = control.millis() + 5000
        let str = g_write.shift()
        for (let i = 0; i < str.length; i++) {
            if (control.millis() > g_write_tmo) { initESerial(); break; }
            writeChar(str[i])
        }
        writeChar(String.fromCharCode(0))
    }
})

// read strings
basic.forever(function () {
    if (!g_init) return;
    let str = ""
    let ch = ""
    if ((pins.digitalReadPin(g_rx_rdy) == 1)) { // available
        g_read_tmo = control.millis() + 5000
        do {
            ch = readChar()
            str += ch
        } while (!ch.isEmpty())
        if (control.millis() <= g_read_tmo)
            g_read.push(str)
        str = ""
    }
})

namespace ESerial {

    export function setPins(tx_dat: DigitalPin,
        tx_rdy: DigitalPin,
        tx_rcv: DigitalPin,
        rx_dat: DigitalPin,
        rx_rdy: DigitalPin,
        rx_rcv: DigitalPin) {
        g_tx_dat = tx_dat
        g_tx_rdy = tx_rdy
        g_tx_rcv = tx_rcv
        g_rx_dat = rx_dat
        g_rx_rdy = rx_rdy
        g_rx_rcv = rx_rcv

        initESerial()
        g_init = true
    }

    export function available(): boolean {
        return (g_read.length > 0)
    }

    export function write(str: string) {
        g_write.push(str)
    }

    export function read(): string {
        if (g_read.length)
            return g_read.shift()
        return ""
    }
}


/////////////////////
//#################//
//##             ##//
//##  eradio.ts  ##//
//##             ##//
//#################//
/////////////////////

let RADIOID = "ID"
let MSGEND = "#EOM#"
let bsyids: string[] = []
let rdymsgs: string[] = []
let bsymsgs: string[] = []

type readhandler = () => void
let readHandler: readhandler

radio.onReceivedString(function (msg: string) {
    // mbit radio buffer size is 19
    // msg format:
    // -----------
    // char 0 :             id length
    // char 1..n :          id
    // char (18 - n)..19 :  msg chunk 

    let idlen: number = +msg.substr(0, 1)
    msg = msg.substr(1)
    let id = msg.substr(0, idlen)
    msg = msg.substr(idlen)
    let ix = 0
    for (; ix < bsyids.length; ix++) {
        if (id == bsyids[ix]) break
    }
    if (ix == bsyids.length) {
        bsyids.push(id)
        bsymsgs.push("") // is handled at the end by 'bsymsgs[ix] += msg'
    }
    if (msg == MSGEND) { // end of message
        rdymsgs.push(bsymsgs[ix])
        bsymsgs.removeAt(ix)
        bsyids.removeAt(ix)
        if (readHandler) readHandler()
        return
    }
    bsymsgs[ix] += msg
})

namespace ERadio {

    export function readMessage(): string {
        let msg = rdymsgs.shift()
        return msg
    }

    export function writeMessage(msg: string) {
        // mbit radio buffer size is 19
        // chunk format:
        // -------------
        // char 0 :             id length
        // char 1..n :          id
        // char (18 - n)..19 :  msg chunk 

        let idlen = RADIOID.length
        let chunk: string
        let chunklen = 18 - idlen // 19 is mbit radio buffer size
        do {
            chunk = msg.substr(0, chunklen)
            msg = msg.substr(chunklen)
            radio.sendString(idlen.toString() + RADIOID + chunk)
            basic.pause(1)
        } while (msg.length > 0)
        radio.sendString(idlen.toString() + RADIOID + MSGEND)
    }

    // for senders only
    export function setId(id: string) {
        RADIOID = id
    }
}


///////////////////////////
//#######################//
//##                   ##//
//##  greenbox-iot.ts  ##//
//##                   ##//
//#######################//
///////////////////////////

ESerial.setPins(
    DigitalPin.P9,
    DigitalPin.P12,
    DigitalPin.P13,
    DigitalPin.P14,
    DigitalPin.P15,
    DigitalPin.P16
)

// initialize

let RUN = true

function init() {
    let str: string
    do {
        if (ESerial.available())
            str = ESerial.read() // did RPI startup ?
        basic.pause(1)
    } while (str != "READY")
    basic.showIcon(IconNames.Heart)
    basic.pause(1000)
    ESerial.write("ACK")
}
init()

// handle messages

runHandler = () => { // button A pressed
    RUN = true
    basic.showIcon(IconNames.Heart)
}

stopHandler = () => { // button B pressed
    RUN = false
    basic.showArrow(ArrowNames.West)
}

readHandler = () => {
    let msg = ERadio.readMessage()
    if (!RUN) return
    if (msg.length > 0) {
        basic.showIcon(IconNames.SmallHeart)
        ESerial.write(msg)
        basic.showIcon(IconNames.Heart)
    }
}
