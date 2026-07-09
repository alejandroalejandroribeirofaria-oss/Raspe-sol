import { useState, useEffect } from 'react';
import { Wallet } from 'lucide-react';

type WalletType = 'phantom' | 'solflare' | null;

export default function ConnectButton() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [walletType, setWalletType] = useState<WalletType>(null);
  const [loading, setLoading] = useState(false);

  // Função para detectar provedor
  const getProvider = (type: WalletType) => {
    if (type === 'phantom') return (window as any).solana;
    if (type === 'solflare') return (window as any).solflare;
    return null;
  };

  // Tenta reconectar automaticamente (só se confiável)
  useEffect(() => {
    const autoConnect = async () => {
      // Tenta Phantom primeiro (mais usado), depois Solflare
      for (const type of ['phantom', 'solflare'] as const) {
        const provider = getProvider(type);
        
        if (provider?.isConnected || provider?.publicKey) {
          try {
            const { publicKey } = await provider.connect({ onlyIfTrusted: true });
            if (publicKey) {
              setWallet(publicKey.toString());
              setWalletType(type);
              return;
            }
          } catch (err) {
            // Ignora erro silenciosamente (usuário ainda não deu permissão)
          }
        }
      }
    };

    autoConnect();
  }, []);

  const connectWallet = async (preferredType?: WalletType) => {
    setLoading(true);

    try {
      // Se o usuário já escolheu um tipo (ex: botão específico)
      const typesToTry = preferredType 
        ? [preferredType] 
        : ['phantom', 'solflare'] as const; // Phantom tem prioridade

      for (const type of typesToTry) {
        const provider = getProvider(type);

        if (!provider) continue;

        // Mensagem amigável se a extensão não estiver instalada
        if (type === 'phantom' && !provider.isPhantom) {
          alert("Phantom não detectado. Instale a extensão!");
          window.open('https://phantom.app/', '_blank');
          return;
        }
        if (type === 'solflare' && !provider.isSolflare) {
          alert("Solflare não detectado. Instale a extensão!");
          window.open('https://solflare.com/', '_blank');
          return;
        }

        const resp = await provider.connect();
        const address = resp.publicKey.toString();

        setWallet(address);
        setWalletType(type);
        
        console.log(`✅ ${type} conectada:`, address);
        return; // Conectou com sucesso → para o loop
      }

      alert("Nenhuma carteira compatível encontrada. Instale Phantom ou Solflare.");

    } catch (err: any) {
      console.error("Erro ao conectar:", err);
      alert("Erro ao conectar a carteira: " + (err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const shortWallet = wallet 
    ? `\( {wallet.slice(0, 4)}... \){wallet.slice(-4)}` 
    : "";

  const disconnect = async () => {
    if (!walletType) return;
    
    const provider = getProvider(walletType);
    try {
      await provider?.disconnect();
    } catch (e) {}
    
    setWallet(null);
    setWalletType(null);
  };

  return (
    <div className="flex items-center gap-3">
      {wallet ? (
        <button
          onClick={disconnect}
          className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 font-semibold transition"
        >
          Desconectar
        </button>
      ) : (
        <button 
          onClick={() => connectWallet()} 
          disabled={loading}
          className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 font-semibold transition"
        >
          <Wallet size={18} />
          {loading ? "Conectando..." : "Conectar Carteira"}
        </button>
      )}

      {wallet && (
        <span className="text-sm text-gray-400 font-mono">
          {shortWallet} ({walletType === 'phantom' ? 'Phantom' : 'Solflare'})
        </span>
      )}
    </div>
  );
  }
