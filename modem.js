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
