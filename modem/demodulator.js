'use strict';

import { MODE_REGISTRY } from './registry.js';

export class FskDemodulatorNode extends AudioWorkletNode {
	constructor(params) {
		if (!params.context) {
			console.log(params);
			throw new Error("No context given");
		}

		const fskParams = MODE_REGISTRY[params.mode];
		if (!fskParams) {
			throw new Error(`Invalid mode ${mode}`);
		}

		super(params.context, 'fsk-demodulator', {
			numberOfInputs: 1,
			numberOfOutputs: 0,
			channelCount: 1,
			channelCountMode: 'explicit',
		});

		this.onmessage = params.onmessage;

		this.port.onmessage = event => {
			if (this.onmessage) {
				this.onmessage(event.data);
			}
		}
		this.port.start();
		this.port.postMessage({
			fskParams: fskParams
		});
	}
}
