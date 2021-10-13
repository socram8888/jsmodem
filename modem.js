'use strict';

const MODE_REGISTRY = {
	'bell103': {
		baud: 300,
		space: 1070,
		mark: 1270,
		rxDelay: 0.002351515183, // score: 1.991238538645
	},
	'bell202': {
		baud: 1200,
		space: 2200,
		mark: 1200,
		rxDelay: 0.000445898150, // score: 1.968674618863
	},
}

export class FskModulatorNode extends AudioWorkletNode {
	constructor(context, mode) {
		super(context, 'fsk-modulator', {
			numberOfInputs: 0,
			numberOfOutputs: 1,
			channelCount: 1,
			channelCountMode: 'explicit',
		});

		const modeConfig = MODE_REGISTRY[mode];
		if (!modeConfig) {
			throw new Exception(`Invalid mode ${mode}`);
		}

		this.nextMessageId = 0;
		this.promises = {};

		this.port.onmessage = event => {
			// Call resolve function for associated message id
			const data = event.data;
			this.promises[data.id]();
			delete this.promises[data.id];
		}

		this.port.start();
		this.port.postMessage({
			config: {
				baud: modeConfig.baud,
				space: modeConfig.space,
				mark: modeConfig.mark,
				// TODO: make this configurable
				preamble: 0.5,
				tail: 0.2,
			}
		});
	}

	async transmit(blob) {
		return new Promise((resolve, reject) => {
			// Check data is a byte array (or can be converted into one)
			let bytes;
			try {
				bytes = new Uint8Array(blob);
			} catch (e) {
				reject(e);
				return;
			}

			// Get current valid message id and increment it
			const messageId = this.nextMessageId;
			this.nextMessageId++;

			// Store success callback in the object property
			this.promises[messageId] = resolve;

			// Issue transmission request
			this.port.postMessage({
				id: messageId,
				bytes: bytes
			});
		});
	}
}

export class FskDemodulatorNode extends AudioWorkletNode {
	constructor(context, mode, handler) {
		super(context, 'fsk-demodulator', {
			numberOfInputs: 1,
			numberOfOutputs: 0,
			channelCount: 1,
			channelCountMode: 'explicit',
		});

		const modeConfig = MODE_REGISTRY[mode];
		if (!modeConfig) {
			throw new Exception(`Invalid mode ${mode}`);
		}

		this.port.onmessage = event => {
			handler(event.data);
		}
		this.port.start();
		this.port.postMessage(modeConfig);
	}
}
