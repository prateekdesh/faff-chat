const { InferenceClient } = require("@huggingface/inference");

let client = null;

class EmbeddingService {
  constructor() {
    // Don't initialize client here - do it lazily
  }

  _getClient() {
    if (!client) {
      if (!process.env.HF_TOKEN) {
        throw new Error("HF_TOKEN environment variable is required");
      }
      client = new InferenceClient(process.env.HF_TOKEN);
    }
    return client;
  }

  async generateEmbedding(text) {
    try {
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error("Invalid text input for embedding generation");
      }

      const client = this._getClient();
      const output = await client.featureExtraction({
        model: "sentence-transformers/all-MiniLM-L6-v2",
        inputs: text.trim(),
        provider: "hf-inference",
      });

      if (!Array.isArray(output) || output.length !== 384) {
        throw new Error("Invalid embedding response from Hugging Face API");
      }

      return output;
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  async generateSentenceSimilarity(sourceSentence, sentences) {
    try {
      const output = await client.sentenceSimilarity({
        model: "sentence-transformers/all-MiniLM-L6-v2",
        inputs: {
          source_sentence: sourceSentence,
          sentences: sentences,
        },
        provider: "hf-inference",
      });

      return output;
    } catch (error) {
      console.error("Error generating sentence similarity:", error);
      throw new Error(`Failed to generate sentence similarity: ${error.message}`);
    }
  }
}

module.exports = new EmbeddingService();
