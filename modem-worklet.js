'use strict';

class UartReceiver {
	constructor(port) {
		this.port = port;

		this.bytes = new Array();
		this.symbolCount = 0;
		this.symbolBuffer = 0;
	}

	feedBit(bit) {
		// Feed bit into buffer
		this.symbolBuffer = bit << 9 | this.symbolBuffer >> 1;
		this.symbolCount++;

		if (this.symbolCount >= 10) {
			// Check that the start bit is low and stop is high
			if ((this.symbolBuffer & 0x201) == 0x200) {
				/*
				 * If it is, a byte has been successfully received.
				 * Add it to the byte buffer and clear the symbol buffer.
				 */
				this.bytes.push((this.symbolBuffer >> 1) & 0xFF);
				this.symbolCount = 0;
			} else {
				/*
				 * Else, we hit an error condition.
				 *
				 * If the bytes buffer contains anything send it now as is.
				 *
				 * We won't reset the symbol count, as this might happen not only in case of
				 * synchronization loss but also if the message is in the lead-in.
				 */
				if (this.bytes.length > 0) {
					this.port.postMessage(new Uint8Array(this.bytes));
				}
				this.bytes = new Array();
			}
		}
	}

	rxFail() {
		if (this.bytes.length > 0) {
			this.port.postMessage(new Uint8Array(this.bytes));
		}
		this.bytes = new Array();
		this.symbolCount = 0;
	}
}

export class FskDemodulatorProcessor extends AudioWorkletProcessor {
	// Experimentally determined to give the best results in noisy environments
	CORR_RATIO = 6 / 8;

	constructor() {
		super();

		this.config = null;

		this.port.onmessage = msg => {
			console.log("Config!", msg.data);
			this.configure(msg.data);
		}
		this.port.start();
	}

	configure(config) {
		this.config = config;

		// Delay line, large enough to hold the optimal delay
		const delaySize = Math.round(this.config.rxDelay * sampleRate) - 1;
		this.delay = new Int8Array(delaySize);
		this.delayPos = 0;

		// Instantiate correlator buffer
		const corSize = Math.round(this.CORR_RATIO * sampleRate / this.config.baud);
		this.correlator = new Int8Array(corSize);
		this.corrPos = 0;
		this.corrSum = 0;

		// No bits have been emitted yet
		this.previousBit = null;
		this.emittedBits = 0;

		this.receiver = new UartReceiver(this.port);
	}

	process(inputs, outputs, parameters) {
		// If hasn't been initialized yet, return
		if (!this.config) {
			return true;
		}

		// Might happen if called before connecting the input
		if (!inputs || !inputs[0] || !inputs[0][0]) {
			return true;
		}

		for (let value of inputs[0][0]) {
			// Calculate the polarity of the current sample
			let curPolarity = value >= 0 ? 1 : -1;

			/*
			 * Multiply with the output of the delay.
			 *
			 * We don't need to special case the start since the buffers are all zero,
			 * so the resulting multiplications will be zero.
			 */
			let newCorrPolarity = this.delay[this.delayPos] * curPolarity;

			// Update the current correlator sum
			let oldCorrPolarity = this.correlator[this.corrPos];
			this.corrSum = this.corrSum - oldCorrPolarity + newCorrPolarity;

			// Overwrite old correlator output
			this.correlator[this.corrPos] = newCorrPolarity;
			this.corrPos = (this.corrPos + 1) % this.correlator.length;

			// Current bit should be inverted if zero frequency is higher than one's
			let currentBit = (this.corrSum >= 0) ^ (this.config.space > this.config.mark);

			if (currentBit == this.previousBit) {
				// Cast to int to floor it
				const previousEmitted = this.emittedBits | 0;
				this.emittedBits += this.config.baud / sampleRate;
				const newEmitted = this.emittedBits | 0;

				// If we have received a new full bit, feed it
				if (previousEmitted != newEmitted) {
					this.receiver.feedBit(currentBit);
				}
			} else {
				/*
				 * If not a single valid bit has been emitted since last polarity change,
				 * the transmission is damaged
				 */
				if (this.emittedBits < 1) {
					this.receiver.rxFail();
				}

				this.previousBit = currentBit;

				// Assume we're in the middle of a valid bit
				this.emittedBits = 0.5;
			}

			// Overwrite old sample in the delay line with the new value
			this.delay[this.delayPos] = curPolarity;
			this.delayPos = (this.delayPos + 1) % this.delay.length;
		}

		return true;
	}
}

registerProcessor('fsk-demodulator', FskDemodulatorProcessor)
