
import { FskModulatorNode } from './modem/modulator.js';
import { FskDemodulatorNode } from './modem/demodulator.js';

function numPad(what, len) {
	what = String(what);
	while (what.length < len) {
		what = "0" + what;
	}
	return what;
}

function timestamp(date) {
	return numPad(date.getHours(), 2) + ":" + numPad(date.getMinutes(), 2) + ":" + numPad(date.getSeconds(), 2);
}

let lastReceived = null;

const messageHandler = x => {
	let newLine;
	try {
		newLine = new TextDecoder('utf-8').decode(x.bytes);
	} catch (e) {
		return;
	}

	const match = newLine.match(/^([A-Za-z0-9-]+): (.+)/);
	if (!match) {
		return;
	}

	const senderDiv = document.createElement("div");
	senderDiv.className = "sender";
	senderDiv.innerText = match[1];

	const timeDiv = document.createElement("div");
	timeDiv.className = "timestamp";
	timeDiv.innerText = timestamp(x.start);

	const textDiv = document.createElement("div");
	textDiv.className = "text";
	textDiv.innerText = match[2];

	const newEntry = document.createElement("div");
	newEntry.appendChild(senderDiv);
	newEntry.appendChild(timeDiv);
	newEntry.appendChild(textDiv);

	const log = document.getElementById("log");
	log.appendChild(newEntry);
}

const handleSuccess = async function(stream) {
	const context = new AudioContext();
	await context.audioWorklet.addModule('modem/demodulator-worklet.js');
	const source = context.createMediaStreamSource(stream);
	const demodNode = new FskDemodulatorNode({
		context: context,
		mode: 'bell103',
		onmessage: messageHandler
	});

	source.connect(demodNode);
};

navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(handleSuccess);

const sendInput = document.getElementById("sendinput");
const sendButton = document.getElementById("sendbtt");
let outputContext = null;

function startTransmission() {
	const lineBytes = new TextEncoder('utf-8').encode('Test: ' + sendInput.value);

	const modNode = new FskModulatorNode({
		context: outputContext,
		mode: 'bell103',
		data: lineBytes,
		onfinished: () => {
			sendInput.value = '';
			sendInput.disabled = false;
			sendButton.disabled = false;
		}
	});
	modNode.connect(outputContext.destination)
}

function sendMessage() {
	sendInput.disabled = true;
	sendButton.disabled = true;

	if (outputContext == null) {
		let ctx = new AudioContext();
		ctx.audioWorklet.addModule('modem/modulator-worklet.js').then(() => {
			outputContext = ctx;
			startTransmission();
		});
	} else {
		startTransmission();
	}
}

sendInput.onsubmit = () => sendMessage();
sendButton.onclick = () => sendMessage();
