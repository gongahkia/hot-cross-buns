package localruntime

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/filelock"
	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
	"github.com/gongahkia/hot-cross-buns/internal/privatefs"
)

type storage struct {
	root *os.Root
	lock *os.File
}

func openStorage(stateDir string) (*storage, error) {
	directory := localmodel.RuntimeDirectory(stateDir)
	if err := privatefs.MkdirAll(directory); err != nil {
		return nil, err
	}
	if err := privatefs.Check(directory); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	lock, err := filelock.OpenRootFile(root, "owner.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err == nil {
		err = filelock.Lock(lock, filelock.Exclusive|filelock.Nonblocking)
	}
	if err != nil {
		if lock != nil {
			lock.Close()
		}
		root.Close()
		return nil, err
	}
	return &storage{root, lock}, nil
}
func (s *storage) close() { s.lock.Close(); s.root.Close() }
func (s *storage) write(name string, value any) error {
	data, err := json.Marshal(value)
	if err != nil || len(data) > 32768 {
		return errors.New("runtime record exceeds bounds")
	}
	return s.writeBytes(name, data)
}
func (s *storage) writeBytes(name string, data []byte) error {
	temp := "." + name + ".tmp"
	file, err := filelock.OpenRootFile(s.root, temp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer s.root.Remove(temp)
	if err = privatefs.Protect(filepath.Join(s.root.Name(), temp)); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if info, e := s.root.Lstat(name); e == nil && !info.Mode().IsRegular() {
		return errors.New("runtime record is not an ordinary file")
	} else if e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	if err = s.root.Rename(temp, name); err != nil {
		return err
	}
	directory, err := os.Open(s.root.Name())
	if err != nil {
		return err
	}
	defer directory.Close()
	return privatefs.SyncDir(directory)
}
func (s *storage) read(name string, value any) error {
	f, err := filelock.OpenRootFile(s.root, name, os.O_RDONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := privatefs.Check(filepath.Join(s.root.Name(), name)); err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil || info.Size() > 32768 {
		return errors.New("runtime record exceeds bounds")
	}
	decoder := json.NewDecoder(io.LimitReader(f, 32769))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid runtime record")
	}
	return nil
}
func (s *storage) certificate(binding *localmodel.RuntimeBinding) (tls.Certificate, error) {
	var key []byte
	if binding.Certificate != "" {
		f, err := filelock.OpenRootFile(s.root, "key.pem", os.O_RDONLY, 0600)
		if err != nil {
			return tls.Certificate{}, err
		}
		defer f.Close()
		if err = privatefs.Check(filepath.Join(s.root.Name(), "key.pem")); err != nil {
			return tls.Certificate{}, err
		}
		key, err = io.ReadAll(io.LimitReader(f, 16385))
		if err != nil || len(key) > 16384 {
			return tls.Certificate{}, errors.New("invalid private runtime key")
		}
	} else {
		private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return tls.Certificate{}, err
		}
		serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
		if err != nil {
			return tls.Certificate{}, err
		}
		template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Hot Cross Buns local runtime"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().AddDate(5, 0, 0), IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true}
		der, err := x509.CreateCertificate(rand.Reader, template, template, &private.PublicKey, private)
		if err != nil {
			return tls.Certificate{}, err
		}
		encoded, err := x509.MarshalPKCS8PrivateKey(private)
		if err != nil {
			return tls.Certificate{}, err
		}
		key = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})
		binding.Certificate = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
		if err := s.writeBytes("key.pem", key); err != nil {
			return tls.Certificate{}, err
		}
	}
	return tls.X509KeyPair([]byte(binding.Certificate), key)
}

// archive retains the latest 32 operation outcomes, never credentials or prompts.
func (s *storage) archive(receipt Receipt) error {
	if receipt.ID == "" {
		return errors.New("missing operation identity")
	}
	if err := s.write("operation-"+receipt.ID+".json", receipt); err != nil {
		return err
	}
	entries, err := os.ReadDir(s.root.Name())
	if err != nil {
		return err
	}
	type record struct {
		name    string
		updated time.Time
	}
	records := []record{}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "operation-") && strings.HasSuffix(entry.Name(), ".json") {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			records = append(records, record{entry.Name(), info.ModTime()})
		}
	}
	sort.Slice(records, func(i, j int) bool { return records[i].updated.After(records[j].updated) })
	for _, old := range records[min(32, len(records)):] {
		if err := s.root.Remove(old.name); err != nil {
			return err
		}
	}
	return nil
}
