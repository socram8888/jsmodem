'use strict';

class FskModulatorProcessor extends AudioWorkletProcessor {
	constructor() {
		super();

		this.params = null;

		// Initialize counters
		this.sampleCount = 0;
		this.symbolCount = 0;
		this.currentPhase = 0;

		// Flag that will be set once the tail has been sent
		this.tailSent = false;

		// Flag that will be set once we've notified the node via the port that we're done
		this.notifiedNode = false;

		// Setup message callback
		this.port.onmessage = msg => {
			this.params = msg.data;

			// Precalculate some often used values
			this.spacePhaseDelta = 2 * Math.PI * this.params.fskParams.space / sampleRate;
			this.markPhaseDelta = 2 * Math.PI * this.params.fskParams.mark / sampleRate;
			this.samplesPerBit = sampleRate / this.params.fskParams.baud;

			// Emit preamble
			this.currentPhaseDelta = this.markPhaseDelta;
			this.symbolEnd = this.params.preamble * sampleRate;

		}
		this.port.start();
	}

	nextSymbol() {
		// If the tail has been sent already, we're done
		if (this.tailSent) {
			// If the node hasn't been notified yet, do so now
			if (!this.notifiedNode) {
				this.port.postMessage({
					done: true
				});
				this.notifiedNode = true;
			}

			return false;
		}

		/*
		 * Calculate byte index.
		 *
		 * We have to divide by 10 because for every 8-bit byte we also have to send one start
		 * bit and one stop bit.
		 */
		const byteIdx = (this.symbolCount / 10) | 0;

		// If we haven't reached yet the end of the current message...
		if (byteIdx < this.params.bytes.length) {
			// Extract bit
			const bitIdx = this.symbolCount % 10 - 1;
			let symbol;

			switch (bitIdx) {
				case -1:
					// Send start bit
					symbol = 0;
					break;

				default:
					// Extract actual bit
					symbol = (this.params.bytes[byteIdx] >> bitIdx) & 1;
					break;

				case 8:
					// Send stop bit
					symbol = 1;
					break;
			}

			this.currentPhaseDelta = symbol ? this.markPhaseDelta : this.spacePhaseDelta;
			this.symbolEnd += this.samplesPerBit;
			this.symbolCount++;

			return true;
		}

		// If transmission is over, send tail
		this.currentPhaseDelta = this.markPhaseDelta;
		this.symbolEnd += this.params.tail * sampleRate;
		this.tailSent = true;
		return true;
	}

	process(inputs, outputs, parameters) {
		// If hasn't been initialized yet, return
		if (!this.params) {
			return true;
		}

		// Might happen if called before connecting the output
		if (!outputs || !outputs[0] || !outputs[0][0]) {
			return true;
		}

		const output = outputs[0][0];
		let outputPos = 0;

		while (outputPos < output.length) {
			if (this.sampleCount >= this.symbolEnd) {
				// If nextSymbol returns false, we're done and we can be garbage collected
				if (!this.nextSymbol()) {
					return false;
				}
			}

			// Generate actual sample
			output[outputPos] = Math.sin(this.currentPhase);
			outputPos++;

			// Increment phase, capped at 2pi to reduce precision loss
			this.currentPhase += this.currentPhaseDelta;
			if (this.currentPhase > Math.PI * 2) {
				this.currentPhase -= Math.PI * 2;
			}

			// Step sample counter
			this.sampleCount++;
		}

		return true;
	}
}

registerProcessor('fsk-modulator', FskModulatorProcessor)
