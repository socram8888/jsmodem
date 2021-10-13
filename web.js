
import { FskModulatorNode, FskDemodulatorNode } from './modem.js';

function numPad(what, len) {
	what = String(what);
	while (what.length < len) {
		what = "0" + what;
	}
	return what;
}

function timestamp() {
	const now = new Date();
	return numPad(now.getHours(), 2) + ":" + numPad(now.getMinutes(), 2) + ":" + numPad(now.getSeconds(), 2);
}

const messageHandler = x => {
	let newLine;
	try {
		newLine = new TextDecoder('utf-8').decode(x);
	} catch (e) {
		return;
	}

	const match = newLine.match(/^([A-Za-z0-9-]+): (.*)$/);
	if (!match) {
		return;
	}

	const senderDiv = document.createElement("div");
	senderDiv.className = "sender";
	senderDiv.innerText = match[1];

	const timeDiv = document.createElement("div");
	timeDiv.className = "timestamp";
	timeDiv.innerText = timestamp();

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
	await context.audioWorklet.addModule('modem-worklet.js');
	const source = context.createMediaStreamSource(stream);
	const demodNode = new FskDemodulatorNode(context, 'bell103', messageHandler);

	source.connect(demodNode);
};

navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(handleSuccess);

const initOutput = async function() {
	let outputContext = new AudioContext();
	await outputContext.audioWorklet.addModule('modem-worklet.js');

	const modNode = new FskModulatorNode(outputContext, 'bell103');
	modNode.connect(outputContext.destination)

	const sendButton = document.getElementById("sendbtt");
	const sendInput = document.getElementById("sendinput");
	sendButton.addEventListener('click', function(e) {
		sendInput.disabled = true;
		sendButton.disabled = true;

		const lineBytes = new TextEncoder('utf-8').encode('Test: ' + sendInput.value);
		modNode.transmit(lineBytes).then(() => {
			sendInput.disabled = false;
			sendButton.disabled = false;
		});
	}, false);
}

initOutput();
